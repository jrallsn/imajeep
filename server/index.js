const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

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

	function initRoom(){
  		var roomId =  generateId();
  		activeRooms[roomId] = [ws];
  		ws.send(JSON.stringify({
  			action: 'roomCreated',
  			roomId: roomId
  		}));
  	}

  	function joinRoom(roomId) {
  		if (activeRooms[roomId]){
  			activeRooms[roomId].push(ws);
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
    	var data = JSON.parse(message);
    	var action = data.action;

    	if(action === 'init'){
    		initRoom();
    	}
    	if(action === 'join') {
    		joinRoom(data.roomId);
    	}
    	if(action === 'testMsg') {
    		testMsg(data.roomId, data.message);
    	}
  	});

  	//ws.send('something');
});
