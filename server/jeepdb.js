var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('../db/jeep.db');

module.exports = {
	createTeamIfNotExists: function (teamName) {
		db.run("INSERT OR IGNORE INTO teams (name) VALUES ('" + teamName + "')");
	},
	createSprint: function (sprintName, teamName) {
		var teamID;
		db.get("SELECT teamID FROM teams WHERE name='"+teamName + "'", function(err, row) {
			teamID = row.teamID;
			db.run ("INSERT OR IGNORE INTO sprints (name, teamID) VALUES('" + sprintName + "', " + teamID + ")");
		});
	},
	getIncompleteActionItems: function(teamName, callback) {
		var actionItems = [];
		db.each("SELECT a.* FROM actions as a JOIN teams as t on t.teamID=a.teamID WHERE a.status=0 and t.name='" + teamName +"'", function(err, rows) {
			actionItems.push(rows);
		}, function() {
			callback(actionItems);
		});
	},
	getPreviousSprintInfo: function(teamName, callback) {
		var previousSprints = [];
		db.each("SELECT s.* FROM sprints as s JOIN teams as t on t.teamID=s.teamID WHERE t.name='" + teamName +"'", function(err, rows) {
			previousSprints.push(rows);
		}, function() {
			callback(previousSprints);
		});
	},
	actionItemComplete: function(actionID) {
		db.run("UPDATE actions SET status=1 WHERE actionID=" + actionID);
	}
};