{
	action: 'init', 'join', 'testMsg'
	info: 'roomCreated', 'userJoined'
	roomId: 
	message: 
	userName: 
}




user joins room:

client sends:

{
	action: 'join',
	roomId: 'ASSF',
	userName: 'someuser'
}


server responds:

{
	info: 'userJoined',
	roomId: 'ASSF',
	userName: 'someuser'
}

OR

{
	info: 'error',
	message: 'room does not exist'
}




{
	action: 'init',
	message: 'team name here'
}

response:

{
	info: 'roomCreated',
	roomId: 'ASDF'
}