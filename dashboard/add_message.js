const http = require('http');

const sender = process.argv[2];
const text = process.argv.slice(3).join(' ');

if (!sender || !text || (sender !== 'user' && sender !== 'agent')) {
  console.log('Usage: node add_message.js <user|agent> <message body...>');
  console.log('Example: node add_message.js user Hello, I need help!');
  process.exit(1);
}

const messageData = JSON.stringify({
  sender,
  text,
  timestamp: new Date().toISOString()
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(messageData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`Success! Message added. Server responded with: ${data}`);
    } else {
      console.log(`Failed. Status: ${res.statusCode}, Response: ${data}`);
    }
  });
});

req.on('error', (e) => {
  console.error(`Error connecting to localhost:3001: ${e.message}`);
  console.error('Make sure your backend message server is running on port 3001.');
});

req.write(messageData);
req.end();
