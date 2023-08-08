const fs = require('fs');
var https = require('https');
const path = require('path');
const {Builder, Button, Browser, By, Capabilities, Key} = require('selenium-webdriver');

// <Settings>--------------------------------------------
var str_browserName = Browser.CHROME;
var str_urlOfJSFiddle = 'https://jsfiddle.net';
var str_outDirName = 'dl';
var str_reportFile = 'report.json'

// <Tunings>----------------------
var int_waitMsForElemLocated = 10000;
var int_msTimeForTimeOut = 10000;
// ---------------------</Tunings>

var str_xpathOfProgressMsg = `//div[@id="i2"]/div[@class="sn"]/div`;
var str_xpathOfImage = `//img[@id="img"]`;
var str_xpathOfNextAnchor = `//a[@id="next"]`;
// -------------------------------------------</Settings>

// Argument check
if(process.argv.length < 3){
    console.error('URL required.');
    return;
}

fs.mkdirSync(str_outDirName, function(e){if(e){throw e}});

// Initialize
var str_url = process.argv[2];
var objarr_dlRequests = [];
var bl_requestDone = false; // すべてのファイルの Download 要求が開始済みかどうか
var bl_watching = false;

var objarr_results = [];
var obj_webDriver;

(async function(){

    // Create WebDriver object
    obj_webDriver = await new Builder()
        .withCapabilities(
            new Capabilities()
                .setBrowserName(str_browserName)
        )
        .build()
    ;

    // Set screen resolution as XGA size
    await obj_webDriver.manage().window().setRect({
        width:1024,
        height:768
    });
    
    // ページ網羅 loop
    while(true){

        var obj_pageReport = await (async function(str_toAnalyzeUrl){

            var obj_pageOverView = {};

            // Navigate
            console.log(`Accessing to ${str_toAnalyzeUrl}`);
            await obj_webDriver.get(str_toAnalyzeUrl);

            // Progress message, image file's URL, next URL の取得
            process.stdout.write('Analyzing page');
            var obj_pageOverViewRet = await obj_webDriver
                .wait(async function(){
                    process.stdout.write('.');
                    var objarr_ProgressMessage = await obj_webDriver
                        .findElements(
                            By.xpath(str_xpathOfProgressMsg)
                        )
                    ;
                    var objarr_Image = await obj_webDriver
                        .findElements(
                            By.xpath(str_xpathOfImage)
                        )
                    ;
                    var objarr_nextAnchor = await obj_webDriver
                        .findElements(
                            By.xpath(str_xpathOfNextAnchor)
                        )
                    ;

                    // Progress message, image file's URL, next URL を取得できたなかった場合は false を返す
                    if(
                        // progress 表示要素が見つからない場合
                        (objarr_ProgressMessage.length != 1) ||

                        // Image 要素が見つからない場合
                        (objarr_Image.length != 1) ||

                        // 次ページを表す URL が見つからない場合
                        !( 0 < objarr_nextAnchor.length)    // <note> id="next" な要素が2つ存在するので、
                                                            // `!(0 < ~.length)` としている </note>

                    ){
                        return false;
                    }

                    obj_pageOverView['progressMessage'] = await objarr_ProgressMessage[0].getText(); //Progress Message
                    obj_pageOverView['imageUrl'] = await objarr_Image[0].getAttribute('src'); // 画像の URL 文字列
                    obj_pageOverView['nextUrl'] = await objarr_nextAnchor[0].getAttribute('href'); // 次の URL 文字列

                    return obj_pageOverView;

                },int_waitMsForElemLocated)
                .catch(function(e){
                    // Time out の場合
                    if( (typeof e) === 'object' && e.constructor.name === "TimeoutError"){
                        let str_msg = `Expected element was not located`;
                        console.error(str_msg);
                        return undefined;
                    
                    }else{ // Time out 以外のエラーの場合
                        throw e; // エラーをそのまま返す
                    }
                })
            ;
            process.stdout.write('\n');

            return obj_pageOverViewRet;

        })(str_url);

        // console.log(obj_pageReport);
        console.log(`Progress:${obj_pageReport['progressMessage']}`);

        // 保存ファイル名の生成
        var str_spaceRemoved = obj_pageReport['progressMessage'].replace(' ','');
        var str_index = str_spaceRemoved.match(/^[0-9]+/)[0]; // 現在の file no
        var str_maxIndex = str_spaceRemoved.match(/[0-9]+$/)[0]; // 全体の file no
        var str_fileName =
            ('0'.repeat(str_maxIndex.length) + str_index).slice(-str_maxIndex.length) +  // 0 埋めした file no
            obj_pageReport['imageUrl'].substr(obj_pageReport['imageUrl'].lastIndexOf('.'))
        ;

        // 非同期でURLからファイルをダウンロード
        objarr_dlRequests.push(new httpsGet(
            obj_pageReport['imageUrl'],
            (str_outDirName + '/' + str_fileName),
            function(obj_result){
                objarr_results.push(obj_result);
                if(bl_requestDone){ // すべてのファイルの Download 要求が開始済みなら

                    if(objarr_dlRequests.length == objarr_results.length){ // ダウンロード未完了 Request が存在しない -> 全 Request を ダウンロードしたら
                        bl_watching = false;
                        process.stdout.write('\033[' + objarr_dlRequests.length + 'A');
                        func_showProgress();
                        func_showResult();
                    }
                    
                }
            }
            
        ))

        if(obj_pageReport['nextUrl'] == str_url){   // アクセスした url が 次のページの URL と一致した場合
                                                    // -> アクセスするべき次の URL が存在しない場合
            break; // ページ網羅 loop を終了

        }else{  // アクセスした url が 次のページの URL と一致しない場合
                // -> アクセスするべき次の URL が存在する場合

            str_url = obj_pageReport['nextUrl']; // 次のページの URL を指定して ページ網羅 loop の先頭へ
        }
        
    }

    bl_requestDone = true;
    console.log('Waiting for image downloading...');

    obj_webDriver.quit(); // ブラウザを閉じる

    func_showProgress();
    bl_watching = true;
    func_showProgressRept();
    
    async function func_showProgressRept(){
        
        await func_sleep(100);

        if(bl_watching){
            // 前回状態の削除
            //todo 上書きする前に消す
            process.stdout.write('\033[' + objarr_dlRequests.length + 'A');

            func_showProgress();
            func_showProgressRept();
        }
    }
    
    function func_showProgress(){

        for(let int_idxOfRequest = 0 ; int_idxOfRequest < objarr_dlRequests.length ; int_idxOfRequest++){
            
            var obj_status = objarr_dlRequests[int_idxOfRequest].getStatus();
    
            var str_toShowIdx = ' '.repeat(objarr_dlRequests.length.toString().length - int_idxOfRequest.toString().length) + int_idxOfRequest.toString();
            process.stdout.write(`(${str_toShowIdx} of ${objarr_dlRequests.length}) `);
            process.stdout.write(`Stage:${obj_status.lastStageNumber}, `);
            if(3 <= obj_status.lastStageNumber){ // dl 開始済みなら
                process.stdout.write(func_makeProgressString(obj_status.downloadedByteSize, obj_status.toDownloadByteSize)); // DL 進捗状態を表示
            }
            if(obj_status.haveDone){
                process.stdout.write(` ${obj_status.message}`);
            }
            process.stdout.write('\n');
    
        }
    }

    function func_sleep(int_mSec) {
        return new Promise(function(resolve) {
     
           setTimeout(function() {resolve()}, int_mSec);
     
        })
     }

})();


// パーセンテージ, 分子(3桁区切り), 分母(3桁区切り)を文字列化して返す
function func_makeProgressString(numerator, denominator){

    var str_toRet;
    var int_digitsOfFlac = 1; // パーセンテージ表示の内の小数点以下の桁数

    var int_parsedDenominator = parseInt(denominator);
    
    var str_toShowNumerator = numerator.toLocaleString();
    var str_toShowDenominator;

    if(isNaN(int_parsedDenominator)){ // 分母が数値として無効な場合(= When 'content-size' property of http response is invalid)
        str_toShowDenominator = 'Unkown';
        str_toShowPercentage = '???.' + '?'.repeat(int_digitsOfFlac);
        
    }else{ // 分母が数値として有効な場合
        str_toShowDenominator = int_parsedDenominator.toLocaleString();
        str_toShowNumerator = ' '.repeat(str_toShowDenominator.length - str_toShowNumerator.length) + str_toShowNumerator; // space padding
        int_progressPercentage = numerator/int_parsedDenominator * 100;
        str_toShowPercentage = int_progressPercentage.toFixed(int_digitsOfFlac);
        str_toShowPercentage = ' '.repeat((4+int_digitsOfFlac) - str_toShowPercentage.length) + str_toShowPercentage;
    }

    str_toRet = `Progress:${str_toShowPercentage}[%] (${str_toShowNumerator}[bytes]/${str_toShowDenominator}[bytes])`;

    return str_toRet;
}

function func_showResult(){

    var int_countOK = 0;
    var int_countNG = 0;

    for(let int_i = 0 ; int_i < objarr_results.length ; int_i++){
        if(objarr_results[int_i].isOK){ //ダウンロード OK なら
            int_countOK++;
        }else{
            int_countNG++;
        }
    }

    console.log('');
    console.log('Done!');
    console.log('');
    console.log('-----------<RESULT>-----------');
    console.log(`TOTAL:${objarr_results.length}`);
    console.log(`OK:${int_countOK}`);
    console.log(`NG:${int_countNG}`);
    console.log('');

    var str_absPathOfResult = path.resolve(str_reportFile);
    fs.writeFile(str_absPathOfResult, JSON.stringify(objarr_results, null, '    '), function(e){if(e){throw e}});
    console.log(`Report saved as "${str_absPathOfResult}"`)
}

//
//  Access to the specified URL and save as file
//
//  Parameters
//  ----------
//  url : String
//      URL to download
//  fileName : String
//      Filepath to save file
//  resultListener : function
//      Callback function that will be fired with 1 argument(see following) when process is ended.  
//      Note. This will be fired whether process ends in scceeded or not.
//          1st Argment : Object
//              Each property means following
//                  isOK : boolean
//                      true if all process ends in scceeded, otherwise false
//                  message : String
//                      Overview of all processes
//                  lastStageNumber : Number
//                      Which process number reached in the download processes that is divided into the following 4 processes
//                          1: 'Wait for http response'
//                          2: 'Got http response'
//                          3: 'Wait for downloading complete
//                          4: 'Completed'
//                  lastStageMessage : Number
//                      Meaning of lastStageNumber above
//                  incomingMsg : Object
//                      Note. This property will be added only if there is responce from the server
//                      Following property of the http response
//                          statusCode : Number
//                              Status code of the http response. Same as message.statusCode of http.IncomingMessage class. To know details, See following.
//                              https://nodejs.org/api/http.html#http_message_statuscode
//                          statusMessage : String
//                              Status message of the http response. Same as message.statusMessage of http.IncomingMessage class. To know details, See following.
//                              https://nodejs.org/api/http.html#http_message_statusmessage
//                          headers : Object
//                              Response header of the http response. Same as message.headers of http.IncomingMessage class. To know details, See following.
//                              https://nodejs.org/api/http.html#http_message_headers
//                          complete
//                              True if download successfully ended otherwise false. Same as message.complete of http.IncomingMessage class. To know details, See following.
//                              https://nodejs.org/api/http.html#http_message_complete
//                  toDownloadByteSize : Number
//                      Note. This property will be added only if there is a valid 'content-size' property in the http response from the server
//                      Total byte size of content.
//                  downloadedByteSize : Number
//                      Note. This property will be added only if downloading process is started
//                      How many bytes downloaded when process ended
//  stageListener : function
//      Callback function that will be fired with 2 argument(see following) when process stage is moved.  
//          1st Argument : Number
//              Which process number reached in the download processes that is divided into the following 4 processes
//                  1: 'Wait for http response'
//                  2: 'Got http response'
//                  3: 'Wait for downloading complete
//                  4: 'Completed'
//          2nd Argument : Number
//              Meaning of 1st argument above
//  dlProgressListener : function
//      Callback function that will be fired with 2 argument(see following) when every 'data' event of download stream.
//          1st Argument : Number
//              Total amount byte size of downloaded completely
//          2nd Argument : Number
//              Content byte size of file
//              Note. This argument will be specified only if there is a valid 'content-size' property in the http response from the server
// 
function httpsGet(url, fileName, resultListener, stageListener, dlProgressListener){

    var int_stage = 0;
    var obj_stageDef = {
        '0': 'Generate http request',
        '1': 'Wait for http response',
        '2': 'Got http response',
        '3': 'Wait for downloading complete',
        '4': 'Completed'
    }

    var bool_haveDone = false;
    var str_reportedMessage;

    var obj_res;
    var int_toDownloadByteSize;
    var int_downloadedByteSize;

    this.getStatus = function(){

        var str_msg = bool_haveDone ? str_reportedMessage : 'Now in progress' ;

        return func_reportStatus(undefined, str_msg, obj_res);
    }

    try{

        // 
        // http.get(url[, options][, callback])  
        // https://nodejs.org/api/http.html#http_http_get_url_options_callback
        // 
        var req = https.get(url, function(obj_incomingMsg){
            // 
            // argument `obj_incomingMsg` is an instance of http.IncomingMessage  
            // https://nodejs.org/api/http.html#http_class_http_incomingmessage
            //
    
            obj_res = {
                'statusCode':obj_incomingMsg.statusCode,
                'statusMessage':obj_incomingMsg.statusMessage,
                'headers':obj_incomingMsg.headers,
                'complete':obj_incomingMsg.complete
            };
    
            // 1: Wait for http response
            //  | | | |
            //  v v v v
            // 2: Got http response
            func_nextStage(); // Goto next stage
            
            if (obj_incomingMsg.statusCode !== 200) {
                //
                // pattern.3 with IncomingMessage
                // HTTP response status code が 200(OK) ではない場合はここにくる
                //
    
                //
                // http.get(url[, options][, callback]) して生成される http.ClientRequest class のドキュメントで、
                // `the data from the response object must be consumed` とのことなので、
                // HTTP response status code が 200(OK) ではない場合は、 `.resume()` して終了する  
                // https://nodejs.org/api/http.html#http_class_http_clientrequest
                //
                obj_incomingMsg.on('end', function(){
                    func_reportResult( // 失敗として終了
                        false,
                        'Bad response. Cannot start downloading.',
                        obj_res)
                    ;
                });
                obj_incomingMsg.resume(); // Consume response data to free up memory
                return;
            }
    
            var obj_writeStream = fs.createWriteStream(fileName);
            obj_incomingMsg.pipe(obj_writeStream);
            
            var int_parsedToDownloadByteSize = parseInt(obj_incomingMsg.headers['content-length']);

            // incomingMsg.headers['content-length'] が整数値として無効な場合は undefined のままとする
            // incl. incomingMsg.headers['content-length'] が存在しない場合
            if(!isNaN(int_parsedToDownloadByteSize)){
                int_toDownloadByteSize = int_parsedToDownloadByteSize;
            }

            int_downloadedByteSize = 0;
            obj_incomingMsg.on('data',function(chunk){
                int_downloadedByteSize += chunk.length;

                if(typeof dlProgressListener == 'function'){
                    dlProgressListener(int_downloadedByteSize, int_toDownloadByteSize);
                }
                
            });
            obj_incomingMsg.on('end', function(){
                
                obj_writeStream.close();
                
                obj_res['complete'] = obj_incomingMsg.complete;
                
                if(!obj_incomingMsg.complete){ // 中断された場合
                    // pattern.4 with IncomingMessage
                    func_reportResult( // 失敗として終了
                        false,
                        'The connection was terminated while the message was still being sent',
                        obj_res)
                    ;
                }else{ //中断されなかった場合

                    // pattern.5 with IncomingMessage

                    // 3: Wait for downloading complete
                    //  | | | |
                    //  v v v v
                    // 4: Completed
                    func_nextStage(); // Goto next stage

                    func_reportResult( // 成功として終了
                        true,
                        'OK',
                        obj_res)
                    ;
                }
            });

            // 2: Got http response
            //  | | | |
            //  v v v v
            // 3: Wait for downloading complete
            func_nextStage(); // Goto next stage
            
        });
    
        req.setTimeout(int_msTimeForTimeOut, function(){
            // 
            // pattern.4 with IncomingMessage
            // Download 中に接続がタイムアウトした場合はここにくる
            // ただし、サーバーとの接続要求でタイムアウトが発生した場合は、
            // `req.on('error', function(e){` がコールされ、
            // この callback はコールされない(note: 設定したタイムアウト用待ち時間は発生する)
            // e.g.
            //  - Download 中のサーバダウン
            //  - Download 中の LAN cable / Wi-Fi 切断
            // 
    
            req.abort(); // Goto -> `obj_incomingMsg.on('end', function(){`
        });
    
        req.on('error', function(e){
            //
            // pattern.2 no IncomingMessage
            // サーバーとの接続確立前に発生したエラーはここにくる
            // e.g. 
            //  - DNS エラー
            //  - http response 取得前に req.abort() or req.destroy() がたたかれた
            //  - https.get した時点でネットワーク接続がない( LAN cable / Wi-Fi 切断等)
            //
            func_reportResult(false, String(e)); // 失敗として終了
            return;
        });
    
    }catch(e){
        //
        // pattern.1 no IncomingMessage
        // URL 文字列が無効な場合に発生したエラーはここにくる
        // e.g.
        //  - URL が `https://` (note: not `http://`) で始まらない  
        //
        func_reportResult(false, String(e)); // 失敗として終了
        return;
    }

    // 0: Generate http request
    //  | | | |
    //  v v v v
    // 1: Wait for http response
    func_nextStage(); // Goto next stage

    function func_nextStage(){
        int_stage++;

        if(typeof stageListener == 'function'){
            stageListener(int_stage, obj_stageDef[int_stage]);
        }
    }

    function func_reportStatus(bool_isOK, str_message, obj_incomingMsg){
        var obj_result = {};

        obj_result['haveDone'] = bool_haveDone;
        if(typeof bool_isOK != 'undefined'){
            obj_result['isOK'] = bool_isOK;
        }
        obj_result['message'] = str_message;
        obj_result['url'] = url;
        obj_result['fileName'] = fileName;
        obj_result['lastStageNumber'] = int_stage;
        obj_result['lastStageMessage'] = obj_stageDef[int_stage];

        if(typeof obj_incomingMsg == 'object'){
            obj_result['incomingMsg'] = {...obj_incomingMsg};
        }
        if(typeof int_toDownloadByteSize == 'number'){
            obj_result['toDownloadByteSize'] = int_toDownloadByteSize;
        }
        if(typeof int_downloadedByteSize == 'number'){
            obj_result['downloadedByteSize'] = int_downloadedByteSize;
        }

        return obj_result;
    }

    function func_reportResult(bool_isOK, str_message, obj_incomingMsg){

        bool_haveDone = true;
        str_reportedMessage = str_message;
        var obj_result = func_reportStatus(bool_isOK, str_message, obj_incomingMsg);

        if(typeof resultListener == 'function'){ 
            resultListener(obj_result);
        }
    }
}
