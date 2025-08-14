import { getDb } from './db.js';
import 'dotenv/config';


(async () => {
  const db = await getDb();
  const journals = await db.collection('journal').find().toArray();
  console.log(journals);
})();
