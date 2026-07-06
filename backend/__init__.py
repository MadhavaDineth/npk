# Use PyMySQL as a drop-in replacement for mysqlclient (MySQLdb), so Django's
# MySQL backend works without needing the C-based mysqlclient build on Windows.
import pymysql

pymysql.install_as_MySQLdb()
