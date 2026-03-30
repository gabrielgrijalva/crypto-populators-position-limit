const {
    loadSettings
} = require('../../settings')
let settings = loadSettings();

const {
    logWithTimestamp,
    handleError
} = require('./index')

const mysql = require('mysql2/promise');

const moment = require('moment');

const pool = mysql.createPool({
    host: settings.database.host,
    user: settings.database.user,
    password: settings.database.password,
    database: settings.database.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


async function tableExists(tableName) {
    const [rows] = await pool.query("SHOW TABLES LIKE ?", [tableName]);
    return rows.length > 0;
}

async function createTable(tableName) {
    try {
        const query = `
            CREATE TABLE ${tableName} (
                timestamp DATETIME NOT NULL,
                leverage_min DECIMAL(10,2) NOT NULL,
                leverage_max DECIMAL(10,2) NOT NULL,
                max_quantity DECIMAL(30,8) NULL,
                max_notional DECIMAL(30,2) NULL,
                PRIMARY KEY (timestamp, leverage_min)
            )
        `;

        await pool.query(query);
    } catch (error) {
        const errorMessage = `Error creating table ${tableName}: ${error.message}`;
        handleError(errorMessage, true);
        throw error;
    }
}

async function insertPositionLimitsData(tableName, data) {
    try {
        if (!data || data.length === 0) return;

        logWithTimestamp(`${tableName}: Inserting ${data.length} rows.`)

        const query = `
            INSERT INTO ${tableName} (timestamp, leverage_min, leverage_max, max_quantity, max_notional)
            VALUES ?
            ON DUPLICATE KEY UPDATE
                leverage_max = VALUES(leverage_max),
                max_quantity = VALUES(max_quantity),
                max_notional = VALUES(max_notional)
        `;

        const values = data.map(row => [
            row.timestamp,
            row.leverageMin,
            row.leverageMax,
            row.maxQuantity,
            row.maxNotional,
        ]);

        await pool.query(query, [values]);

    } catch (error) {
        const errorMessage = `Error inserting position limits data into table ${tableName}: ${error.message}`;
        handleError(errorMessage, false);
        throw error;
    }
}

async function deleteOldData(daysToKeep, callback) {
    try {
        const cutoffDate = moment().utc().subtract(daysToKeep, 'days').startOf('minute').format('YYYY-MM-DD HH:mm:ss');

        const [tables] = await pool.query(
            `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE '%_position_limits_%'`,
            [settings.database.database]
        );

        for (const table of tables) {
            const tableName = table.TABLE_NAME;

            const deleteQuery = `
                DELETE FROM ${mysql.escapeId(tableName)}
                WHERE timestamp < ?
            `;
            const [result] = await pool.query(deleteQuery, [cutoffDate]);
            const deletedCount = result.affectedRows;
            logWithTimestamp(`Deleted ${deletedCount} rows from table ${tableName}`);
        }

    } catch (error) {
        console.error('Error in deleteOldData:', error);
        handleError(`Error deleting old data: ${error.message}`, true);
    }

    if (callback) callback();
}

module.exports = {
    tableExists,
    createTable,
    insertPositionLimitsData,
    deleteOldData
};
