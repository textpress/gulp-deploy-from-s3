import AWS from "aws-sdk";
import axios from "axios";
import through from "through2";
import Promise from "bluebird";
import crypto from "crypto";
import confirm from "gulp-confirm";
import gulp from "gulp";
import isString from "lodash/isString";
import fs from "fs";
import path from "path";
import yargs from "yargs";


export function readPackageJson() {
    return JSON.parse( fs.readFileSync( path.join( process.cwd(), "package.json" ) ) );
}


export function getDeploySignature( body ) {
    const ssm = new AWS.SSM( { region: "us-east-1" } );
    const getParameter = Promise.promisify( ssm.getParameter, { context: ssm } );
    return getParameter( { Name: "/textpress-ci/signatureSecret", WithDecryption: true } )
        .then( result => {
            const signatureSecret = result.Parameter.Value;
            if ( !signatureSecret )
                throw new Error( "Could not obtain signature secret" );

            const hmac = "sha1";
            const hash = crypto.createHmac( hmac, signatureSecret )
                .update( body )
                .digest( "hex" );
            return `${hmac}=${hash}`;
        } );
}


export function makeDeployRequest( body ) {
    return getDeploySignature( body )
        .then( singature => {
            const client = axios.create( {
                baseURL: "https://zp1v6aciyk.execute-api.us-east-1.amazonaws.com",
                headers: { "X-Hub-Signature": singature }
            } );

            return client.post( "/production/deploy-from-s3", body );
        } );
}


export function deploy( argv ) {
    const version = argv.version;
    if ( !isString( version ) )
        throw new Error( "Version is missing, usage: yarn deploy -v 0.0.1 -s staging" );

    const stage = argv.stage === true ? "staging" : argv.stage;
    if ( [ "development", "staging", "production" ].indexOf( stage ) === -1 )
        throw new Error( "Stage is missing, usage: yarn deploy -v 0.0.1 -s staging" );

    const packageJson = readPackageJson();
    return gulp.src( "" )
        .pipe( confirm( {
            question: `\x1B[37mDeploy version \x1B[4m\x1B[36m${version}\x1B[24m\x1B[37m to \x1B[4m\x1B[36m${stage}\x1B[24m\x1B[37m?\x1B[22m`,
            input: "_key:y"
        } ) )
        .pipe( through.obj( function ( chunk, enc, cb ) {
            const _this = this;

            const body = JSON.stringify( {
                repository: `${packageJson.author}/${packageJson.name}`,
                version,
                stage
            } );

            makeDeployRequest( body )
                .then( () => { cb(); } )
                .catch( x => {
                    _this.emit( "error", x );
                    cb();
                } );
        } ) );
}


export function registerTask() {
    gulp.task( "deploy", () => deploy( yargs.alias( "v", "version" ).alias( "s", "stage" ).argv ) );
}

export default deploy;
