const express = require('express'); //express is a web application framework that allows us to call URLS like /procedure and get results without a web server
const passport = require('passport'); //passport is for authentication to lock down the URLs
const app = express(); //create express application
const xsenv = require('@sap/xsenv'); //this allows us to consume or bound services that we see in BTP cockpit
const hanaService = xsenv.getServices({ hana: { tag: "hana" } }); //variable for the hana service from BTP Cockpit
const xsuaaService = xsenv.getServices({ uaa: { tag: "xsuaa" } }); //variable for xsuaa service from BTP cockpit
const port = process.env.PORT || 3000; //sets the port that is generated from the environment variables or 3000 if nothing is set
const JWTStrategy = require('@sap/xssec').JWTStrategy; //xssec is the advanced container security API and we set a JWT token

//set global variables for accessing the jobscheduler job, run, and schedule id, set them Null before each run starts
var global_scheduler_host = "";
var global_run_at = "";
var global_job_id = "";
var global_schedule_id = "";
var global_run_id = "";

const JobSchedulerClient = require('@sap/jobs-client'); //module for making REST calls to the job scheduler
const scheduler = new JobSchedulerClient.Scheduler(); //create a new connection to the job scheduler


//configure passport to lock down web calls to express app
//const xsuaaCredentials = xsuaaService.uaa;
//const jwtStrategy = new JWTStrategy(xsuaaCredentials)
//passport.use(jwtStrategy);
passport.use(new JWTStrategy(xsenv.getServices({xsuaa:{tag:'xsuaa'}}).xsuaa));

//jwt logger
function jwtLogger(req, res, next) {
    let authHeader = req.headers.authorization;
    if (authHeader) {
        var theJwtToken = authHeader.substring(7);
        if (theJwtToken) {
            let jwtBase64Encoded = theJwtToken.split('.')[1];
            if (jwtBase64Encoded) {
                let jwtDecoded = Buffer.from(jwtBase64Encoded, 'base64').toString('ascii');
                let jwtDecodedJson = JSON.parse(jwtDecoded);
                console.log('===> [JWT-LOGGER]: JWT contains scopes: ' + jwtDecodedJson.scope);
                console.log('===> [JWT-LOGGER]: JWT contains client_id sent by Jobscheduler: ' + jwtDecodedJson.client_id);
            }
        }
    }
    next()
}

//define /procedure/:name app for job scheduling
app.use(jwtLogger); 
console.log('app.use(jwtLogger); ');
app.use(passport.initialize()); 
console.log('app.use(passport.initialize()); ');
app.use(passport.authenticate('JWT', { session: false }));
console.log('app.use(passport.authenticate(JWT, { session: false }));');

app.get('/test', function (req, res) {
	console.log('i have entered app.get /test');
	res.status(200).send('send 200 app.get /test');
});

app.get('/procedure/:name', function (req, res) {
	console.log('i have entered app.get /procedure/name');
    //check headers to validate its from sap job scheduler
    if (typeof req.headers['x-sap-scheduler-host'] !== "undefined") {
		//set global variable for job scheduler header info for job id, schedule id, run id
        global_scheduler_host = req.headers['x-sap-scheduler-host'];
		global_run_at = req.headers['x-sap-run-at'];
		global_job_id = req.headers['x-sap-job-id'];
		global_schedule_id = req.headers['x-sap-job-schedule-id'];
		global_run_id = req.headers['x-sap-job-run-id'];
        //send 202 accepted status and call jobHandler
        res.status(202).send('202 - Acknowledge procedure ' + req.params.name);
        jobHandler(req.params.name);
    }
    else {
    	
		//if headers are not from job scheduler send http 500
        res.status(500).send('ONLY ACCEPT CALLS FROM JOB SCHEDULER');
	}
});

//jobHandler creates hana connection and executes procedure
const jobHandler = function(procName) {
    var hdbext = require("@sap/hdbext"); //hdbext are the hana client extension libraries

    //create connection to HANA
    hdbext.createConnection(hanaService.hana, function (error, client) {
        if (error){
            console.log('hana error: ' + error);
        }
        //call procedure based on the name parameter in the URL
        client.exec('CALL "' + procName + '"()', function (err, results){
        
            //if there is an error, log the errr and send error to job scheduler
            if (err)
            {
                console.log('err: ' + err);
                setJobSchedulerStatusError(err);

            }
            //if the job completes log the results and send success to job scheduler
            else { 
                console.log('results: ' + results);
                setJobSchedulerStatusComplete(procName);
            }
        });
    });
    
}

//sets job scheduler information if job was successful
const setJobSchedulerStatusComplete = function (message) {
    console.log('Called setJobSchedulerStatusComplete'); 

    var outStr = "";

    //update local variables to what was received originally from the job scheduler
    var last_scheduler_host = global_scheduler_host;
    var last_run_at = global_run_at;
    var last_job_id = global_job_id;
    var last_schedule_id = global_schedule_id;
    var last_run_id = global_run_id;

    // Call Job Scheduler to indicate complete
    var responseJSON = {message: "none"};
   
    //set data value "succes":"true" indicating the job was successful
    var data = { "success": true, "message": 'Job ' + message + ' completed successfully'  };
        
     //set json for job scheduler headers and update with the data variable   
    var suRunLog = {
        jobId: last_job_id,
        scheduleId: last_schedule_id,
        runId: last_run_id,
        data: data
    };

    //call jobscheduler rest API to update the job logs
    scheduler.updateJobRunLog(suRunLog, (error, result) => {
        if (error) {
            console.log('Error update run log: %s', error);
        }
        else {
            console.log('OK update run log: %s', result);

            global_scheduler_host = "";
            global_run_at = "";
            global_job_id = "";
            global_schedule_id = "";
            global_run_id = "";

            }
            return null;
        });

}

//sets job scheduler information if job was successful
const setJobSchedulerStatusError = function (message) {
    console.log('Called setJobSchedulerStatusError'); 

    var outStr = "";

    var last_scheduler_host = global_scheduler_host;
    var last_run_at = global_run_at;
    var last_job_id = global_job_id;
    var last_schedule_id = global_schedule_id;
    var last_run_id = global_run_id;

    // Call Job Scheduler to indicate complete
    var responseJSON = {message: "none"};
   
    var data = { "success": false, "message": 'ERROR' + message};
        
    var suRunLog = {
        jobId: last_job_id,
        scheduleId: last_schedule_id,
        runId: last_run_id,
        data: data
    };

    scheduler.updateJobRunLog(suRunLog, (error, result) => {

        if (error) {
            console.log('Error update run log: %s', error);
        }
        else {
            console.log('OK update run log: %s', result);
    
            global_scheduler_host = "";
            global_run_at = "";
            global_job_id = "";
            global_schedule_id = "";
            global_run_id = "";

        }
        return null;
    });

}

//express listens for calls to the /procedure/name URls
app.listen(port, function () {
    console.log('Server is running');
})
