import "dotenv/config";
import { Pesapal } from "../src/services/pesapal.js";
const r = await new Pesapal().registerIpn();
console.log("Set PESAPAL_IPN_ID in your server environment to: " + r.ipn_id);
