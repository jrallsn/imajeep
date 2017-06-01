const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });
var JeepDbAdapter = require('./jeepdb.js');


const GameStates = {
    WAITING_FOR_PLAYERS: 'WAITING_FOR_PLAYERS',
    SELECT_GAME: 'SELECT_GAME',
    FEELS_MENU: 'FEELS_MENU',
    SHOW_OLD_ACTION_ITEMS_LIST: 'SHOW_OLD_ACTION_ITEMS_LIST',
    REVIEW_AN_ACTION_ITEM: 'REVIEW_AN_ACTION_ITEM',
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
  		if (activeRooms[roomId]){
  			activeRooms[roomId].players.push({
                playerName: userName,
                socket: ws
            });

            /* send notification to everyone */
  		} else {

  		}
  	}

  	function testMsg(roomId, content){
  		if (!activeRooms[roomId]){
  			return;
  		}

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
                /* TODO */
                break;
            case 'selectGame':
                /* TODO */
                break;
            case 'previousSprints':
                break;
            case 'newSprint':
                break;
            case 'startActionItems':
                break;
            case 'submitVotes':
                break;
            case 'submitFeedback':
                break;
            case 'createActionItem':
                break;
        }

  	});

  	//ws.send('something');
});
