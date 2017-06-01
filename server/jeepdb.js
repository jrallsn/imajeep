var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('jeep.db');

module.exports = {
	createTeamIfNotExists: function (teamName) {
		db.run("INSERT INTO teams (name) SELECT '" + teamName + "' WHERE NOT EXISTS(SELECT 1 FROM teams WHERE name='" + teamName + "');");
	}
};

