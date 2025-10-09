const http = require('http');

const token = "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICI3LXY2ek1vZ21pM28wbDVrRGs5R3ZkUlNJcWpVYXg0UlZFOHA5REF4amd3In0.eyJleHAiOjE3NTk5OTg2MzIsImlhdCI6MTc1OTk5ODMzMiwianRpIjoib25ydHJvOjdmYjBkZDg5LTY1MTItNDdhNy1lNDdlLTkyYzM0Mjk1Zjg0NCIsImlzcyI6Imh0dHA6Ly9sb2NhbGhvc3Q6ODA4MC9yZWFsbXMvbWNwX3NlY3VyaXR5IiwiYXVkIjpbIm1jcC1zZXJ2ZXItY2xpZW50IiwibWNwLW9hdXRoIl0sInN1YiI6IjQyOGUxN2U5LTIxZjYtNDhjMS1hYzk0LTc4ZjQ3MmVjNjcwNCIsInR5cCI6IkJlYXJlciIsImF6cCI6Im1jcC1vYXV0aCIsInNpZCI6ImJhMjZhMDNhLTliYTMtNGM4YS04NTQyLWI3OGU3YTQ0NmUyMCIsInNjb3BlIjoiZW1haWwiLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsInJvbGVzIjpbImFkbWluIl0sInByZWZlcnJlZF91c2VybmFtZSI6ImFsaWNlQHRlc3QubG9jYWwiLCJlbWFpbCI6ImFsaWNlQHRlc3QubG9jYWwifQ.cs2u-It5sy36oyHy-nyFXIjTOw-RT2ReqpPjLcF35YTrPFUtBP4Q0X5cEJ3nqU1tC-SsJO5HWpx4LH2MvmscE7Tsb6yvrovTwXrUXn_SQTvNUT7Rh_GzK1UcmHwt_h7CNHC5lYkM6RFb4RDZPLJYmplGAvQOf8OZHJxyCvRydpWvAieP92gsx11Wd3-MacMqdqxU54P-g4l0oDZs3N4XP9SyHECMAta8cxOQRrJ9moQFGJTuVBUlt-96XhPQsbsAfDVRVPZPSrZ2wJBE4Zu2gUPPVBvl2RBA-qnLYd4lMeOuGHHEwopOFsF-A7Ikxhwhx_j1xjkTP6Z2ioqkv85lcQ";

const postData = JSON.stringify({
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' }
  },
  id: 1
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/mcp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Testing MCP initialize...\n');

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode} ${res.statusMessage}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  console.log();

  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Response Body:');
    try {
      console.log(JSON.stringify(JSON.parse(data), null, 2));
    } catch (e) {
      console.log(data);
    }
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(postData);
req.end();
