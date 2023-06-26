import { getConnectionPool } from "./utils/connection";

export const handler = async (event: { exampleId?: number, delete?: number }): Promise<void> => {
  const connection = await getConnectionPool();

  const randomNumber = Math.floor(Math.random() * 1000);
  if (event.exampleId) {
    if (event.delete) {
      await connection.query(
        `DELETE FROM ${process.env.DB_NAME}.${process.env.TABLE_NAME} WHERE id = ${event.exampleId};`
      );
    } else {
      await connection.query(
        `UPDATE ${process.env.DB_NAME}.${process.env.TABLE_NAME} SET example = 'hello ${randomNumber}' WHERE id = ${event.exampleId};`
      );
    }
  } else {
    await connection.query(
      `INSERT INTO ${process.env.DB_NAME}.${process.env.TABLE_NAME} (example) VALUES ('hello ${randomNumber}');`
    );
  }
};
