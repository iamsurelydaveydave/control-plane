import { MongoClient, ObjectId } from "mongodb";
import { useDNSService } from "./src/services/dns.service";
import { initRepo } from "./src/utils/repo";

async function main() {
  const client = new MongoClient(process.env.MONGO_URI!);
  await client.connect();
  
  await initRepo(client.db("control-plane"));
  
  const db = client.db("control-plane");
  const database = await db.collection("cp_databases").findOne({});
  
  if (!database) {
    console.log("No database found");
    await client.close();
    return;
  }
  
  console.log("Database:", database.name);
  
  const servers = await db.collection("cp_servers").find({
    _id: { $in: database.nodes.map((n: any) => new ObjectId(n.serverId)) }
  }).toArray();
  
  const nodeMap = new Map(servers.map((s: any) => [s._id.toString(), s]));
  
  const nodes = database.nodes.map((n: any) => {
    const server = nodeMap.get(n.serverId.toString()) as any;
    return { host: server?.host as string, port: 27017 };
  });
  
  console.log("Nodes:", nodes);
  
  const dns = useDNSService();
  
  console.log("\nSetting up DNS...");
  const result = await dns.setupReplicaSet({
    databaseName: database.name,
    nodes,
    adminUser: database.credentials.adminUser,
    adminPassword: database.credentials.adminPassword,
    replicaSetName: database.config?.replicaSetName || "primary",
  });
  
  if (result) {
    console.log("\nSuccess!");
    console.log("Cluster Host:", result.clusterHost);
    console.log("Node Hosts:", result.nodeHosts);
    console.log("Records:", result.records.length);
    
    await db.collection("cp_databases").updateOne(
      { _id: database._id },
      { $set: { 
        dns: {
          enabled: true,
          provider: "cloudflare",
          clusterHost: result.clusterHost,
          nodeHosts: result.nodeHosts,
          srvConnectionString: result.srvConnectionString,
          records: result.records,
          configuredAt: new Date(),
        }
      }}
    );
    console.log("Database updated");
  }
  
  await client.close();
}

main().catch(console.error);
