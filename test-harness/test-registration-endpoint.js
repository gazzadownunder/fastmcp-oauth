/**
 * Test script to verify registration_endpoint in /.well-known/oauth-authorization-server
 *
 * Usage: node test-harness/test-registration-endpoint.js
 */

import http from 'http';

const SERVER_URL = 'http://localhost:3000';
const ENDPOINT = '/.well-known/oauth-authorization-server';

console.log('========================================');
console.log('Testing RFC 7591 Registration Endpoint');
console.log('========================================\n');

console.log(`Fetching: ${SERVER_URL}${ENDPOINT}\n`);

http.get(`${SERVER_URL}${ENDPOINT}`, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}\n`);

    if (res.statusCode === 200) {
      try {
        const metadata = JSON.parse(data);
        console.log('Authorization Server Metadata:');
        console.log(JSON.stringify(metadata, null, 2));
        console.log('\n========================================');

        if (metadata.registration_endpoint) {
          console.log('✅ SUCCESS: registration_endpoint is present');
          console.log(`   Value: ${metadata.registration_endpoint}`);
        } else {
          console.log('❌ FAILURE: registration_endpoint is missing');
          console.log('   Expected: registration_endpoint field in response');
        }
        console.log('========================================\n');
      } catch (error) {
        console.error('❌ ERROR: Failed to parse JSON response');
        console.error('   Raw response:', data);
      }
    } else {
      console.error(`❌ ERROR: Server returned status ${res.statusCode}`);
      console.error('   Response:', data);
    }
  });
}).on('error', (err) => {
  console.error('❌ ERROR: Failed to connect to server');
  console.error('   Make sure the server is running:');
  console.error('   > cd test-harness && start-phase3-server.bat');
  console.error('\n   Error details:', err.message);
});
