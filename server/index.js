const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });
var JeepDbAdapter = require('./jeepdb.js');

const votingTimeLimit = 60000;  // default time limit in ms
const resultsDisplayTime = 10000; // time to display results in ms
const actionItemCompleteProportion = 0.75;

const GameStates = {
    WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
    SELECT_GAME: 'SELECT_GAME',
    FEELS_MENU: 'FEELS_MENU',
    SHOW_OLD_ACTION_ITEMS_LIST: 'SHOW_OLD_ACTION_ITEMS_LIST',
    REVIEW_ACTION_ITEMS: 'REVIEW_ACTION_ITEMS',
    SHOW_ACTION_ITEMS_RESULTS: 'SHOW_ACTION_ITEMS_RESULTS',
    SUBMIT_SADS: 'SUBMIT_SADS',
    DISCUSS_SADS: 'DISCUSS_SADS',
    VOTE_SADS: 'VOTE_SADS',
    CREATE_ACTION_ITEMS: 'CREATE_ACTION_ITEMS',
    SUBMIT_HAPPIES: 'SUBMIT_HAPPIES',
    DISCUSS_HAPPIES: 'DISCUSS_HAPPIES',
    VOTE_HAPPIES: 'VOTE_HAPPIES'
};

function generateId() {
	len = 4;
    charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    var uid = '';
    for (var i = 0; i < len; i++) {
        uid += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }

    return uid;
}

var activeRooms = {};

function updateAllPlayers (roomId, updateObject) {
    var updateText = JSON.stringify(updateObject);
    
    for (var i = 0; i < activeRooms[roomId].players.length; i++){
        activeRooms[roomId].players[i].socket.send(updateText);
    }
}

function updateMasterClient (roomId, updateObject) {
    var updateText = JSON.stringify(updateObject);
    activeRooms[roomId].masterSocket.send(updateText);
}

function updateAllClients (roomId, updateObject) {
    updateMasterClient (roomId, updateObject);
    updateAllPlayers (roomId, updateObject);
}

wss.on('connection', function connection(ws) {

	///var roomId = generateId();
	var type;

	function initRoom(teamName){
  		var roomId =  generateId();
        JeepDbAdapter.createTeamIfNotExists(teamName);

  		activeRooms[roomId] = {
            teamName: teamName,
            masterSocket: ws,
            state: GameStates.WAITING_FOR_PLAYERS,
            players: []
        };

  		ws.send(JSON.stringify({
  			action: 'roomCreated',
  			roomId: roomId
  		}));
  	}

  	function joinRoom(roomId, userName) {
  		if (activeRooms[roomId].state === GameStates.WAITING_FOR_PLAYERS){
  			activeRooms[roomId].players.push({
                playerName: userName,
                socket: ws
            });

            var allUserNames = [];
            
            for (var i = 0; i < activeRooms[roomId].players.length; i++){
                allUserNames.push(activeRooms[roomId].players[i].playerName);
            }

            var gameUpdate = {
                info: 'userJoined',
                roomId: roomId,
                userName: userName,
                activeUsers: allUserNames,
                state: activeRooms[roomId].state
            };

            updateAllClients(gameUpdate);
  		} else {

  		}
  	}

    function allPlayersJoined(roomId) {
        activeRooms[roomId].state = GameStates.SELECT_GAME;

        var gameUpdate = {
            info: 'allPlayersJoined',
            roomId: roomId,
            state: activeRooms[roomId].state
        };

        updateAllClients(gameUpdate);
    }

    function selectGame(roomId, gameName) {
        activeRooms[roomId].state = GameStates.FEELS_MENU;

        var gameUpdate = {
            info: 'gameSelected',
            roomId: roomId,
            state: activeRooms[roomId].state,
            gameName: gameName
        };
    }

    function getPreviousSprintInfo(roomId) {
        var teamName = activeRooms[roomId].teamName;

        JeepDbAdapter.getPreviousSprintInfo(teamName, function(sprintInfo){
            var gameUpdate = {
                info: 'previousSprintInfo',
                roomId: roomId,
                state: activeRooms[roomId].state,
                teamName: teamName,
                message: sprintInfo
            };

            activeRooms[roomId].masterSocket.send(JSON.stringify(gameUpdate));
        });        
    }

    function newSprint (roomId, sprintName) {
        activeRooms[roomId].state = GameStates.SHOW_OLD_ACTION_ITEMS_LIST;
        var teamName = activeRooms[roomId].teamName;

        JeepDbAdapter.getIncompleteActionItems(teamName, function(oldActionItems){
            var gameUpdate = {
                info: 'oldActionItems',
                roomId: roomId,
                state: activeRooms[roomId].state,
                teamName: teamName,
                message: oldActionItems
            };

            updateAllClients(gameUpdate);
        });  
    }

    function startActionItems (roomId) {
        activeRooms[roomId].state = GameStates.REVIEW_ACTION_ITEMS;

        var oldActionItems = JeepDbAdapter.getIncompleteActionItems(teamName, function(oldActionItems){
            activeRooms[roomId].actionItemsToRate = oldActionItems;
            activeRooms[roomId].voteReceived = {};
            activeRooms[roomId].actionItemsCount = oldActionItems.length;
            activeRooms[roomId].actionItemsCompleted = 0;

            for(var i = 0; i < activeRooms[roomId].players.length; i++){
                activeRooms[roomId].voteReceived[activeRooms[roomId].players[i].playerName] = false;
            }

            startVoting(roomId);
        });
    }

    function startVoting (roomId) {
        if (activeRooms[roomId].actionItemsToRate.length === 0) {
            endActionItemsPhase(roomId);
            return;
        }

        for(var userName in activeRooms[roomId].voteReceived) {
            if(!activeRooms[roomId].voteReceived.hasOwnProperty(userName)){
                continue;
            }

            activeRooms[roomId].voteReceived[userName] = false;
        }
        activeRooms[roomId].votes = {};

        activeRooms[roomId].currentActionItem = activeRooms[roomId].actionItemsToRate.pop();

        var gameUpdate = {
            info: 'startVoting',
            roomId: roomId,
            itemInfo: activeRooms[roomId].currentActionItem.description,
            timeLimit: votingTimeLimit
        };

        activeRooms[roomId].timer = setTimeout(function(){
            endVoting(roomId);
        }, votingTimeLimit);

        updateAllClients(roomId, gameUpdate);
    }

    function endVoting (roomId) {
        clearTimeout(activeRooms[roomId].timer);

        var playerUpdate = {
            info: 'votingEnded',
            roomId: roomId
        };

        updateAllPlayers(roomId, playerUpdate);

        var totalVote = 0;

        for(var uname in activeRooms[roomId].votes){
            if(!activeRooms[roomId].votes.hasOwnProperty(uname)){
                continue;
            }

            totalVote += activeRooms[roomId].votes[uname];
        }

        var votingResultText = totalVote + ' / ' + activeRooms[roomId].players.length;
        var actionItemComplete = false;
        if ((totalVote / activeRooms[roomId].players.length) >= actionItemCompleteProportion) {
            actionItemComplete = true;
            activeRooms[roomId].actionItemsCompleted++;
        }

        if(actionItemComplete){
            JeepDbAdapter.setActionItemComplete(activeRooms[roomId].currentActionItem.actionID);
        }

        var masterUpdate = {
            info: 'votingEnded',
            roomId: roomId,
            whoVoted: activeRooms[roomId].voteReceived,
            itemInfo: actionItem.text,
            voteResult: votingResultText,
            itemComplete: actionItemComplete,
            displayTime: resultsDisplayTime
        };

        updateMasterClient(roomId, masterUpdate);

        setTimeout(startVoting(roomId), resultsDisplayTime);
    }

    function recordVote (roomId, userName, vote) {
        if (activeRooms[roomId].voteReceived[userName]){
            // don't vote twice
            return;
        }

        activeRooms[roomId].voteReceived[userName] = true;
        activeRooms[roomId].votes[userName] = vote;

        var allVotesReceived = true;

        for(var user in activeRooms[roomId].voteReceived) {
            if(!activeRooms[roomId].voteReceived.hasOwnProperty(user)){
                continue;
            }

            if(!activeRooms[roomId].voteReceived[user]){
                allVotesReceived = false;
                break;
            }
        }

        if(allVotesReceived) {
            endVoting (roomId);
        }
    }

    function endActionItemsPhase (roomId) {
        delete activeRooms[roomId].voteReceived;
        delete activeRooms[roomId].votes;

        activeRooms[roomId].state = GameStates.SHOW_ACTION_ITEMS_RESULTS;

        var masterUpdate = {
            info: 'actionItemsResults',
            roomId: roomId,
            state: activeRooms[roomId].state,
            actionItemsCompletedNumber: activeRooms[roomId].actionItemsCompleted,
            actionItemsTotalNumber: activeRooms[roomId].actionItemsCount,
            displayTime: resultsDisplayTime
        };

        delete activeRooms[roomId].actionItemsCompleted;
        delete activeRooms[roomId].actionItemsCount;

        updateMasterClient(roomId, masterUpdate);

        setTimeout(startFeels(roomId), resultsDisplayTime);
    }

    function startFeels(roomId) {

    }

  	function testMsg(roomId, content){
  		for (var i = 0; i < activeRooms[roomId].length; i++){
  			var socket = activeRooms[roomId][i];
  			socket.send(JSON.stringify({
  				message: content 
  			}));
  		}
  	}

	ws.on('message', function incoming(message) {
    	console.log('received: %s', message);
        var data;
        try{
    	    data = JSON.parse(message);
        } catch (e) {
            console.error(e);
            return;
        }
    	var action = data.action;
        if(data.roomId && !activeRooms[data.roomId]){
            console.error('Attempted action ' + data.action + ' but Room ID ' + roomId + ' not initialized');
            return;
        }

        switch (action) {
            case 'init':
                initRoom(data.message);
                break;
            case 'join':
                joinRoom(data.roomId, data.userName);
                break;
            case 'testMsg':
                testMsg(data.roomId, data.message);
                break;
            case 'allPlayersJoined':
                allPlayersJoined(data.roomId);
                break;
            case 'selectGame':
                selectGame(data.roomId, data.gameName);
                break;
            case 'previousSprints':
                getPreviousSprintInfo(data.roomId);
                break;
            case 'newSprint':
                newSprint(data.roomId, data.sprintName);
                break;
            case 'startActionItems':
                startActionItems(data.roomId);
                break;
            case 'submitVote':
                recordVote(data.roomId, data.userName, data.vote);
                break;
            case 'submitFeedback':
                break;
            case 'createActionItem':
                break;
        }

  	});

  	//ws.send('something');
});
