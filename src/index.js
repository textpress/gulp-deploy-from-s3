import AWS from "aws-sdk";
import axios from "axios";
import through from "through2";
import Promise from "bluebird";
import crypto from "crypto";
import confirm from "gulp-confirm";
import gulp from "gulp";
import chalk from "chalk";
import semver from "semver";
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


export function parseTarget( target ) {
    const result = ( target + "" ).split( "@" );
    return result.length == 1 && semver.valid( result[0] )
        ? { stage: "staging", version: result[0] }
        : { stage: result[0], version: semver.valid( result[1] ) };
}


export function packageRepo( packageJson ) {
    return packageJson.repository.replace( /^github:/, "" );
}


export function deploy( target ) {
    const stages = [ "development", "staging", "production" ];
    const usage = chalk`{bold yarn deploy {cyan <stage>}@0.0.1}, where {cyan <stage>} is one of the following: {bold ${ stages.join( ", " ) }}`;

    const { stage, version } = parseTarget( target );
    if ( !version )
        throw new Error( `Version is missing, usage: ${usage}` );

    if ( stages.indexOf( stage ) === -1 )
        throw new Error( `Unknown stage, usage: ${usage}` );

    const packageJson = readPackageJson();
    return gulp.src( "" )
        .pipe( confirm( {
            question: chalk`Deploy version {bold {cyan ${version}}} of {bold ${packageJson.name}} to {bold {cyan ${stage}}}?`,
            input: "_key:y"
        } ) )
        .pipe( through.obj( function ( chunk, enc, cb ) {
            const _this = this;

            const body = JSON.stringify( {
                repository: packageRepo( packageJson ),
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
    gulp.task( "deploy", () => deploy( yargs.argv.target ) );
}

export default deploy;
