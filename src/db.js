import { MongoClient } from 'mongodb';

// Carrega variáveis do .env se o arquivo existir (recurso nativo do Node, sem dependência).
try {
  process.loadEnvFile('.env');
} catch {
  // .env é opcional — segue com os valores padrão abaixo.
}

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27018';
const MONGO_DB = process.env.MONGO_DB || 'desafio_xcl';

export async function connect() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`Conectado ao MongoDB em ${MONGO_URL} (db: ${MONGO_DB})`);
  return { client, db: client.db(MONGO_DB) };
}
