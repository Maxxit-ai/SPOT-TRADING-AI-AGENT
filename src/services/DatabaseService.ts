import { MongoClient, Db, ChangeStream, ChangeStreamDocument } from "mongodb";
import { logger } from "../config/logger";

interface DatabaseConfig {
  signalFlowUri: string;
  signalFlowDb: string;
  signalFlowCollection: string;
  safeDeploymentUri: string;
  safeDeploymentDb: string;
  safeCollection: string;
}

class DatabaseService {
  private signalFlowClient: MongoClient | null = null;
  private safeDeploymentClient: MongoClient | null = null;
  private signalFlowDb: Db | null = null;
  private safeDeploymentDb: Db | null = null;
  private config: DatabaseConfig;
  private logger = logger;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      // Connect to signal flow database
      this.signalFlowClient = new MongoClient(this.config.signalFlowUri);
      await this.signalFlowClient.connect();
      this.signalFlowDb = this.signalFlowClient.db(this.config.signalFlowDb);

      // Connect to safe deployment database
      this.safeDeploymentClient = new MongoClient(
        this.config.safeDeploymentUri
      );
      await this.safeDeploymentClient.connect();
      this.safeDeploymentDb = this.safeDeploymentClient.db(
        this.config.safeDeploymentDb
      );

      this.logger.info("Successfully connected to both databases");
    } catch (error) {
      this.logger.error("Failed to connect to databases:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.signalFlowClient) {
        await this.signalFlowClient.close();
      }
      if (this.safeDeploymentClient) {
        await this.safeDeploymentClient.close();
      }
      this.logger.info("Disconnected from databases");
    } catch (error) {
      this.logger.error("Error disconnecting from databases:", error);
    }
  }

  getSignalFlowDb(): Db {
    if (!this.signalFlowDb) {
      throw new Error("Signal flow database not connected");
    }
    return this.signalFlowDb;
  }

  getSafeDeploymentDb(): Db {
    if (!this.safeDeploymentDb) {
      throw new Error("Safe deployment database not connected");
    }
    return this.safeDeploymentDb;
  }

  createSignalChangeStream(): ChangeStream {
    const collection = this.getSignalFlowDb().collection(
      this.config.signalFlowCollection
    );

    // Watch for insert operations only
    const pipeline = [
      {
        $match: {
          operationType: "insert",
        },
      },
    ];

    return collection.watch(pipeline, { fullDocument: "updateLookup" });
  }

  async getUserSafe(
    username: string,
    safeAddress?: string
  ): Promise<any | null> {
    try {
      const safesCollection = this.getSafeDeploymentDb().collection(
        this.config.safeCollection
      );

      const query: any = {
        "userInfo.userId": username,
        status: "active",
      };

      // If Safe address is provided, add it to the query to find the specific Safe
      if (safeAddress) {
        // Check all possible deployment addresses in the deployments object
        query.$or = [
          // Check if any deployment has the specified address
          { "deployments.sepolia.address": safeAddress },
          { "deployments.arbitrum.address": safeAddress },
          { "deployments.arbitrum_sepolia.address": safeAddress },
          { "deployments.base_sepolia.address": safeAddress },
          { "deployments.polygon.address": safeAddress },
          { "deployments.optimism.address": safeAddress },
          { "deployments.ethereum.address": safeAddress },
          { "deployments.base.address": safeAddress },
          // Also check top-level safeAddress field in case it exists
          { safeAddress: safeAddress },
        ];
      }

      this.logger.info(`🔍 Searching for safe with query:`, {
        query,
        collection: this.config.safeCollection,
        database: this.config.safeDeploymentDb,
      });

      const safe = await safesCollection.findOne(query);

      if (!safe && safeAddress) {
        // If specific Safe not found, try without the Safe address filter but log warning
        this.logger.warn(
          `⚠️ Specific Safe ${safeAddress} not found for user ${username}. Searching for any Safe...`
        );

        const fallbackQuery = {
          "userInfo.userId": username,
          status: "active",
        };

        const fallbackSafe = await safesCollection.findOne(fallbackQuery);

        if (fallbackSafe) {
          this.logger.warn(`Found alternative Safe for user ${username}:`, {
            foundAddress: this.extractSafeAddressFromDeployments(fallbackSafe),
            requestedAddress: safeAddress,
          });

          // Return null to indicate the specific Safe wasn't found
          return null;
        }
      }

      if (!safe) {
        // Try to find the user with any status to help debug
        const userWithAnyStatus = await safesCollection.findOne({
          "userInfo.userId": username,
        });

        if (userWithAnyStatus) {
          this.logger.warn(
            `⚠️ User ${username} found but status is "${userWithAnyStatus.status}" instead of "active"`
          );

          // Log detailed information about the found user for debugging
          this.logger.info(`User document structure:`, {
            id: userWithAnyStatus._id,
            status: userWithAnyStatus.status,
            networkKey: userWithAnyStatus.networkKey,
            safeAddress: userWithAnyStatus.safeAddress,
            deployments: userWithAnyStatus.deployments,
            userInfo: userWithAnyStatus.userInfo,
          });

          // Return the user even if status is not active, but with a warning
          if (
            userWithAnyStatus.status === "deployed" ||
            userWithAnyStatus.status === "pending"
          ) {
            this.logger.warn(
              `Using Safe with status "${userWithAnyStatus.status}" for user ${username}`
            );
            return userWithAnyStatus;
          }
        } else {
          this.logger.warn(
            `⚠️ User ${username} not found in collection. Let me check alternative field names...`
          );

          // Check alternative field structures
          const alternativeQueries = [
            { "userInfo.username": username, status: "active" },
            { userId: username, status: "active" },
            { username: username, status: "active" },
            // Also check without status filter
            { "userInfo.username": username },
            { userId: username },
            { username: username },
          ];

          for (const altQuery of alternativeQueries) {
            const altResult = await safesCollection.findOne(altQuery);
            if (altResult) {
              this.logger.info(
                `✅ Found user with alternative query:`,
                altQuery
              );
              this.logger.info(`Alternative result structure:`, {
                id: altResult._id,
                status: altResult.status,
                networkKey: altResult.networkKey,
                safeAddress: altResult.safeAddress,
                deployments: altResult.deployments,
                userInfo: altResult.userInfo,
              });
              return altResult;
            }
          }
        }
      } else {
        this.logger.info(`✅ Safe found for user ${username}`);
        this.logger.info(`Safe details:`, {
          id: safe._id,
          status: safe.status,
          networkKey: safe.networkKey,
          safeAddress: safe.safeAddress,
          deployments: safe.deployments,
        });
      }

      return safe;
    } catch (error) {
      this.logger.error(`Error fetching safe for user ${username}:`, error);
      return null;
    }
  }

  // Helper method to extract Safe address from deployments
  private extractSafeAddressFromDeployments(safeDoc: any): string[] {
    const addresses: string[] = [];
    if (safeDoc.deployments) {
      for (const deployment of Object.values(safeDoc.deployments)) {
        if ((deployment as any).address) {
          addresses.push((deployment as any).address);
        }
      }
    }
    return addresses;
  }

  async getActiveDeployments(safeDoc: any): Promise<any[]> {
    const activeDeployments = [];

    if (safeDoc.deployments) {
      for (const [networkKey, deployment] of Object.entries(
        safeDoc.deployments
      )) {
        if (
          (deployment as any).isActive &&
          (deployment as any).deploymentStatus === "deployed"
        ) {
          activeDeployments.push({
            networkKey,
            // Ensure safeAddress is available (map from address field)
            safeAddress: (deployment as any).address,
            ...(deployment as any),
          });
        }
      }
    }

    this.logger.info(
      `Found ${activeDeployments.length} active deployments:`,
      activeDeployments.map((d) => ({
        networkKey: d.networkKey,
        safeAddress: d.safeAddress,
        deploymentStatus: d.deploymentStatus,
      }))
    );

    return activeDeployments;
  }
}

export default DatabaseService;
export { DatabaseConfig };
