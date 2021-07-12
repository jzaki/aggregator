import {
  Constraint,
  CreateTableMode,
  DataType,
  OrderByType,
  QueryClient,
  QueryTable,
  TableOptions,
  unsketchify,
} from "../../deps/index.ts";

import assertExists from "../helpers/assertExists.ts";
import * as env from "./env.ts";

export type TransactionData = {
  txId?: number;
  pubKey: string;
  nonce: number;
  signature: string;
  contractAddress: string;
  methodId: string;
  encodedParams: string;
};

const txOptions: TableOptions = {
  txId: { type: DataType.Serial, constraint: Constraint.PrimaryKey },
  pubKey: { type: DataType.VarChar, length: 258 },
  nonce: { type: DataType.Integer },
  signature: { type: DataType.VarChar, length: 130 },
  contractAddress: { type: DataType.VarChar, length: 42 },
  methodId: { type: DataType.VarChar, length: 10 },
  encodedParams: { type: DataType.VarChar },
};

export default class TxTable {
  txTable: QueryTable<TransactionData>;

  private constructor(public queryClient: QueryClient, txTableName: string) {
    this.txTable = this.queryClient.table<TransactionData>(txTableName);

    if (env.LOG_QUERIES) {
      const originalQuery = this.txTable.client.query.bind(
        this.txTable.client,
      );

      this.txTable.client.query = async (...args) => {
        console.log("query:", ...args);
        return await originalQuery(...args);
      };
    }
  }

  static async create(
    queryClient: QueryClient,
    txTableName: string,
  ): Promise<TxTable> {
    const txTable = new TxTable(queryClient, txTableName);
    await txTable.txTable.create(txOptions, CreateTableMode.IfNotExists);

    return txTable;
  }

  async add(...txs: TransactionData[]) {
    await this.txTable.insert(...txs);
  }

  async remove(...txs: TransactionData[]) {
    for (const tx of txs) {
      const whereClause = this.txTable
        .where({ txId: assertExists(tx.txId) })
        .make();

      await this.txTable.client.query(
        `DELETE FROM ${unsketchify(this.txTable.name)} ${whereClause.sql}`,
        whereClause.params,
      );

      // The delete above should be just:
      // ```ts
      // await this.txTable
      //   .where({ txId: assertExists(tx.txId) })
      //   .delete();
      // ```
      // however it is affected by this bug in PostQuery:
      // https://github.com/DjDeveloperr/PostQuery/pull/7
    }
  }

  async count(): Promise<bigint> {
    const result = await this.queryClient.query(
      `SELECT COUNT(*) FROM ${this.txTable.name}`,
    );
    return result[0].count as bigint;
  }

  async First(): Promise<TransactionData | null> {
    const rows = await this.txTable
      .where()
      .order({
        column: "txId",
        type: OrderByType.Ascending,
      })
      .limit(1)
      .select();

    return rows[0] ?? null;
  }

  async selectByPubKey(
    pubKey: string,
    limit: number,
  ): Promise<TransactionData[]> {
    return await this.txTable
      .where({ pubKey })
      .order({
        column: "nonce",
        type: OrderByType.Ascending,
      })
      .limit(limit)
      .select();
  }

  async all(): Promise<TransactionData[]> {
    return await this.queryClient.query(`SELECT * FROM ${this.txTable.name}`);
  }

  async drop() {
    await this.txTable.create(txOptions, CreateTableMode.DropIfExists);
  }

  async nextNonceOf(pubKey: string): Promise<number | null> {
    const results = await this.txTable
      .where({ pubKey })
      .order({
        column: "nonce",
        type: OrderByType.Descending,
      })
      .limit(1)
      .select();

    if (results.length === 0) {
      return null;
    }

    return results[0].nonce + 1;
  }

  async clear() {
    return await this.queryClient.query(`DELETE from ${this.txTable.name}`);
  }

  async clearBeforeId(txId: number) {
    await this.queryClient.query(`
      DELETE from ${this.txTable.name}
      WHERE txId < ${txId}
    `);
  }
}
