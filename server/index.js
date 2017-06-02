const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });
var JeepDbAdapter = require('./jeepdb.js');

const votingTimeLimit = 5000;  // default time limit in ms
const submissionTimeLimit = 20000;
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
    VIEW_ALL_SADS: 'VIEW_ALL_SADS',
    CREATE_ACTION_ITEMS: 'CREATE_ACTION_ITEMS',
    SUBMIT_HAPPIES: 'SUBMIT_HAPPIES',
    DISCUSS_HAPPIES: 'DISCUSS_HAPPIES',
    VOTE_HAPPIES: 'VOTE_HAPPIES',
    VIEW_ALL_HAPPIES: 'VIEW_ALL_HAPPIES'
};

function generateId() {
	len = 4;
    charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    var uid = '';
    for (var i = 0; i < len; i++) {
        uid += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }

    return 'JEEP';//uid;
}

var activeRooms = {};

function updateAllPlayers (roomId, updateObject) {
    var updateText = JSON.stringify(updateObject);
    console.log('sending (players): %s', updateText);
    for (var i = 0; i < activeRooms[roomId].players.length; i++){
        activeRooms[roomId].players[i].socket.send(updateText, function(err){
            if(err){
                console.error(err);
            }
        });
    }
}

function updateMasterClient (roomId, updateObject) {
    var updateText = JSON.stringify(updateObject);
    console.log('sending (master): %s', updateText);
    activeRooms[roomId].masterSocket.send(updateText, function(err){
        if(err){
            console.error(err);
        }
    });
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
  			info: 'roomCreated',
  			roomId: roomId,
            state: activeRooms[roomId].state
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

            updateAllClients(roomId, gameUpdate);
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

        updateAllClients(roomId, gameUpdate);
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

	    JeepDbAdapter.createSprint(sprintName, teamName);

        JeepDbAdapter.getIncompleteActionItems(teamName, function(oldActionItems){
            var gameUpdate = {
                info: 'oldActionItems',
                roomId: roomId,
                state: activeRooms[roomId].state,
                teamName: teamName,
                message: oldActionItems
            };

            updateAllClients(roomId, gameUpdate);
        });  
    }

    function startActionItems (roomId) {
        activeRooms[roomId].state = GameStates.REVIEW_ACTION_ITEMS;
        var teamName = activeRooms[roomId].teamName;

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
            state: activeRooms[roomId].state,
            itemInfo: activeRooms[roomId].currentActionItem.description,
            timeLimit: votingTimeLimit,
            whoVoted: activeRooms[roomId].voteReceived
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
            roomId: roomId,
            state: activeRooms[roomId].state
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
            JeepDbAdapter.actionItemComplete(activeRooms[roomId].currentActionItem.actionID);
        }

        var masterUpdate = {
            info: 'votingEnded',
            roomId: roomId,
            state: activeRooms[roomId].state,
            whoVoted: activeRooms[roomId].voteReceived,
            itemInfo: activeRooms[roomId].currentActionItem.description,
            voteResult: votingResultText,
            itemComplete: actionItemComplete,
            displayTime: resultsDisplayTime
        };

        updateMasterClient(roomId, masterUpdate);

        setTimeout(function(){
            startVoting(roomId);
        }, resultsDisplayTime);
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

        var masterUpdate = {
            info: 'voteReceived',
            roomId: roomId,
            state: activeRooms[roomId].state,
            userName: userName,
            whoVoted: activeRooms[roomId].voteReceived
        };

        updateMasterClient(roomId, masterUpdate);

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

        setTimeout(function(){startSads(roomId);}, resultsDisplayTime);
    }

    function startSads(roomId) {
        activeRooms[roomId].state = GameStates.SUBMIT_SADS;
        activeRooms[roomId].feedbackItems = [];
        activeRooms[roomId].feedbackReceived = {};

        for(var i = 0; i < activeRooms[roomId].players.length; i++){
            activeRooms[roomId].feedbackReceived[activeRooms[roomId].players[i].playerName] = false;
        }

        var gameUpdate = {
            info: 'startSubmittingSads',
            roomId: roomId,
            state: activeRooms[roomId].state,
            timeLimit: submissionTimeLimit,
            whoSubmitted: activeRooms[roomId].feedbackReceived
        };

        updateAllClients(roomId, gameUpdate);

        activeRooms[roomId].timer = setTimeout(function(){
            endSubmittingSads(roomId);
        }, submissionTimeLimit);
    }

    function startHappies(roomId) {
        activeRooms[roomId].state = GameStates.SUBMIT_HAPPIES;
        activeRooms[roomId].feedbackItems = [];
        activeRooms[roomId].feedbackReceived = {};

        for(var i = 0; i < activeRooms[roomId].players.length; i++){
            activeRooms[roomId].feedbackReceived[activeRooms[roomId].players[i].playerName] = false;
        }

        var gameUpdate = {
            info: 'startSubmittingHappies',
            roomId: roomId,
            state: activeRooms[roomId].state,
            timeLimit: submissionTimeLimit,
            whoSubmitted: activeRooms[roomId].feedbackReceived
        };

        updateAllClients(roomId, gameUpdate);

        activeRooms[roomId].timer = setTimeout(function(){
            endSubmittingHappies(roomId);
        }, submissionTimeLimit);
    }

    function submitFeedback(roomId, userName, feedback) {
        activeRooms[roomId].feedbackItems.push(feedback);
        activeRooms[roomId].feedbackReceived[userName] = true;

        var masterUpdate = {
            info: 'feedbackReceived',
            roomId: roomId,
            state: activeRooms[roomId].state,
            whoSubmitted: activeRooms[roomId].feedbackReceived
        };

        updateMasterClient(roomId, masterUpdate);

        if (activeRooms[roomId].state === GameStates.SUBMIT_SADS){

        } else if (activeRooms[roomId].state === GameStates.SUBMIT_HAPPIES) {

        }
    }

    function endSubmittingSads(roomId) {
        clearTimeout(activeRooms[roomId].timer);
        activeRooms[roomId].state = GameStates.DISCUSS_SADS;

        var gameUpdate = {
            info: 'discussSads',
            roomId: roomId,
            state: activeRooms[roomId].state,
            whoSubmitted: activeRooms[roomId].feedbackReceived,
            feedbackItems: activeRooms[roomId].feedbackItems
        };

        updateAllClients(roomId, gameUpdate);
    }

    function endSubmittingHappies(roomId) {
        clearTimeout(activeRooms[roomId].timer);
        activeRooms[roomId].state = GameStates.DISCUSS_HAPPIES;

        var gameUpdate = {
            info: 'discussHappies',
            roomId: roomId,
            state: activeRooms[roomId].state,
            whoSubmitted: activeRooms[roomId].feedbackReceived,
            feedbackItems: activeRooms[roomId].feedbackItems
        };

        updateAllClients(roomId, gameUpdate);
    }

    function initSadsVoting(roomId) {
        activeRooms[roomId].state = GameStates.VOTE_SADS;

        var feedbackItems = activeRooms[roomId].feedbackItems;
        activeRooms[roomId].feedbackItemsToRate = feedbackItems;
        activeRooms[roomId].voteReceived = {};
        activeRooms[roomId].feedbackItemsCount = feedbackItems.length;
        activeRooms[roomId].feedbackItemsWithScores = [];

        for(var i = 0; i < activeRooms[roomId].players.length; i++){
            activeRooms[roomId].voteReceived[activeRooms[roomId].players[i].playerName] = false;
        }

        startSadsVoting(roomId);
    }

    function startSadsVoting(roomId) {
        if (activeRooms[roomId].feedbackItemsToRate.length === 0) {
            endSadsPhase(roomId);
            return;
        }

        for(var userName in activeRooms[roomId].voteReceived) {
            if(!activeRooms[roomId].voteReceived.hasOwnProperty(userName)){
                continue;
            }

            activeRooms[roomId].voteReceived[userName] = false;
        }
        activeRooms[roomId].votes = {};

        activeRooms[roomId].currentFeedbackItem = activeRooms[roomId].feedbackItemsToRate.pop();

        var gameUpdate = {
            info: 'startSadsVoting',
            roomId: roomId,
            state: activeRooms[roomId].state,
            itemInfo: activeRooms[roomId].currentFeedbackItem,
            timeLimit: votingTimeLimit,
            whoVoted: activeRooms[roomId].voteReceived
        };

        activeRooms[roomId].timer = setTimeout(function(){
            endSadsVoting(roomId);
        }, votingTimeLimit);

        updateAllClients(roomId, gameUpdate);
    }

    function endSadsVoting (roomId) {
        clearTimeout(activeRooms[roomId].timer);

        var playerUpdate = {
            info: 'sadsVotingEnded',
            state: activeRooms[roomId].state,
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

        activeRooms[roomId].feedbackItemsWithScores.push({
            feedbackText: activeRooms[roomId].currentFeedbackItem,
            score: (totalVote / activeRooms[roomId].players.length)
        });

        var votingResultText = totalVote + ' / ' + activeRooms[roomId].players.length;

        var masterUpdate = {
            info: 'sadsVotingEnded',
            roomId: roomId,
            state: activeRooms[roomId].state,
            whoVoted: activeRooms[roomId].voteReceived,
            itemInfo: activeRooms[roomId].currentFeedbackItem,
            voteResult: votingResultText,
            displayTime: resultsDisplayTime
        };

        updateMasterClient(roomId, masterUpdate);

        setTimeout(function(){startSadsVoting(roomId);}, resultsDisplayTime);
    }

    function endSadsPhase (roomId) {
        delete activeRooms[roomId].voteReceived;
        delete activeRooms[roomId].votes;

        activeRooms[roomId].state = GameStates.VIEW_ALL_SADS;

        var masterUpdate = {
            info: 'sadsResults',
            roomId: roomId,
            state: activeRooms[roomId].state,
            displayTime: resultsDisplayTime,
            feedback: activeRooms[roomId].feedbackItemsWithScores
        };

        updateMasterClient(roomId, masterUpdate);
    }

    function initHappiesVoting(roomId) {
        activeRooms[roomId].state = GameStates.VOTE_HAPPIES;

        var feedbackItems = activeRooms[roomId].feedbackItems;
        activeRooms[roomId].feedbackItemsToRate = feedbackItems;
        activeRooms[roomId].voteReceived = {};
        activeRooms[roomId].feedbackItemsCount = feedbackItems.length;
        activeRooms[roomId].feedbackItemsWithScores = [];

        for(var i = 0; i < activeRooms[roomId].players.length; i++){
            activeRooms[roomId].voteReceived[activeRooms[roomId].players[i].playerName] = false;
        }

        startSadsVoting(roomId);
    }

    function startHappiesVoting(roomId) {
        if (activeRooms[roomId].feedbackItemsToRate.length === 0) {
            endSadsPhase(roomId);
            return;
        }

        for(var userName in activeRooms[roomId].voteReceived) {
            if(!activeRooms[roomId].voteReceived.hasOwnProperty(userName)){
                continue;
            }

            activeRooms[roomId].voteReceived[userName] = false;
        }
        activeRooms[roomId].votes = {};

        activeRooms[roomId].currentFeedbackItem = activeRooms[roomId].feedbackItemsToRate.pop();

        var gameUpdate = {
            info: 'startHappiesVoting',
            roomId: roomId,
            state: activeRooms[roomId].state,
            itemInfo: activeRooms[roomId].currentFeedbackItem,
            timeLimit: votingTimeLimit,
            whoVoted: activeRooms[roomId].voteReceived
        };

        activeRooms[roomId].timer = setTimeout(function(){
            endSadsVoting(roomId);
        }, votingTimeLimit);

        updateAllClients(roomId, gameUpdate);
    }

    function endHappiesVoting (roomId) {
        clearTimeout(activeRooms[roomId].timer);

        var playerUpdate = {
            info: 'happiesVotingEnded',
            state: activeRooms[roomId].state,
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

        activeRooms[roomId].feedbackItemsWithScores.push({
            feedbackText: activeRooms[roomId].currentFeedbackItem,
            score: (totalVote / activeRooms[roomId].players.length)
        });

        var votingResultText = totalVote + ' / ' + activeRooms[roomId].players.length;

        var masterUpdate = {
            info: 'happiesVotingEnded',
            roomId: roomId,
            state: activeRooms[roomId].state,
            whoVoted: activeRooms[roomId].voteReceived,
            itemInfo: activeRooms[roomId].currentFeedbackItem,
            voteResult: votingResultText,
            displayTime: resultsDisplayTime
        };

        updateMasterClient(roomId, masterUpdate);

        setTimeout(function(){startSadsVoting(roomId);}, resultsDisplayTime);
    }

    function endHappiesPhase (roomId) {
        delete activeRooms[roomId].voteReceived;
        delete activeRooms[roomId].votes;

        activeRooms[roomId].state = GameStates.VIEW_ALL_HAPPIES;

        var masterUpdate = {
            info: 'happiesResults',
            roomId: roomId,
            state: activeRooms[roomId].state,
            displayTime: resultsDisplayTime,
            feedback: activeRooms[roomId].feedbackItemsWithScores
        };

        updateMasterClient(roomId, masterUpdate);
    }

    function startActionItemCreation (roomId){
        activeRooms[roomId].state = GameStates.CREATE_ACTION_ITEMS;

        var gameUpdate = {
            info: 'createActionItems',
            roomId: roomId,
            state: activeRooms[roomId].state
        };

        updateAllClients(roomId, gameUpdate);
    }

    function createActionItem (roomId, text){
        var teamName = activeRooms[roomId].teamName;

        JeepDbAdapter.addActionItem(text, teamName);

        var gameUpdate = {
            info: 'actionItemCreated',
            roomId: roomId,
            state: activeRooms[roomId].state
        };

        updateAllClients(roomId, gameUpdate);
    }



  	function testMsg(roomId, content){
        updateAllClients(roomId, {message: content});
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

        data.roomId = data.roomId || '';
        if(action !== 'init' && !activeRooms[data.roomId]){
            console.error('Attempted action ' + data.action + ' but Room ID ' + data.roomId + ' not initialized');
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
                submitFeedback(data.roomId, data.userName, data.feedback);
                break;
            case 'startActionItemCreation':
                startActionItemCreation(data.roomId);
                break;
            case 'createActionItem':
                creatActionItem(data.roomId, data.message);
                break;
            case 'startSadsVoting':
                initSadsVoting(data.roomId);
                break;
            case 'startHappiesVoting':
                initHappiesVoting(data.roomId);
                break;
            case 'startHappiesPhase':
                startHappies(data.roomId);
                break;
        }

  	});

  	//ws.send('something');
});
