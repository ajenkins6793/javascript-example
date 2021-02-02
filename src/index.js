// import the bigquery library
var BQ = require('@google-cloud/bigquery');

// grab variables from another js file
var config = require('./secrets');

// increment a variable
var a = 1;
a++;

var b = 1;
b+=4; // increment by 4

// escape quotes using \
var c = "i am escaping \"this\""

// big query
'use strict';

function main() {

    // Import the Google Cloud client library
    const {BigQuery} = require('@google-cloud/bigquery');

    async function query() {

        // Create a client
        const bigqueryClient = new BigQuery();

        // The SQL query to run
        const sqlQuery = `SELECT *
            FROM \`insight-186822.address.geox_v2\`
            LIMIT 10`;

        const options = {
        query: sqlQuery,
        // Location must match that of the dataset(s) referenced in the query.
        location: 'US',
        };

        // Run the query
        const [rows] = await bigqueryClient.query(options);

        console.log('Rows:');
        rows.forEach(row => console.log(row));
    }

    query();
  }

main();