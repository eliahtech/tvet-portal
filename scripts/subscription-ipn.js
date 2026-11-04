import "dotenv/config";
import { ownerPesapal } from "../src/services/subscriptions.js";
const result = await ownerPesapal().registerIpn();
console.log("Set OWNER_PESAPAL_IPN_ID on the server to: " + result.ipn_id);
