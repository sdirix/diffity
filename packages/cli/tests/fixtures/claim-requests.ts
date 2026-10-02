import { claimNextRequest } from '../../src/agent-requests.js';
import { getDb } from '../../src/db.js';

// Opens the database first and starts claiming at GO_AT, so two of these processes compete for the same queue.
getDb();
const goAt = Number(process.env.GO_AT);
while (Date.now() < goAt) {
  // Spin until the start time.
}
const claimed: string[] = [];
for (let request = claimNextRequest(); request; request = claimNextRequest()) {
  claimed.push(request.id);
}
console.log(JSON.stringify(claimed));
