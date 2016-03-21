var Sequelize = require("sequelize");

const {
    npm_package_config_mysql_database,
    npm_package_config_mysql_user,
    npm_package_config_mysql_password,
    npm_package_config_mysql_host,
    npm_package_config_mysql_port,
    npm_package_config_sql_debug
} = process.env

module.exports = new Sequelize(
    npm_package_config_mysql_database,
    npm_package_config_mysql_user,
    npm_package_config_mysql_password, {
    host: npm_package_config_mysql_host,
    port: npm_package_config_mysql_port,
    dialect: 'mysql',
    logging: (args)=>{
        if( global.SQL_DEBUG )
            console.log("SQL_DEBUG ",args)
    } 
});
