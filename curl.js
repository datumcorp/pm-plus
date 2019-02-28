// const cookie = require('cookie')
const yargs = require('yargs')
const URL = require('url')
// const querystring = require('querystring')

/**
 * given this: [ 'msg1=value1', 'msg2=value2' ]
 * output this: 'msg1=value1&msg2=value2'
 * @param dataArguments
 */
function joinDataArguments(args) {
    var data = ''
    args.map((arg, i) => {
        if (i === 0) data += arg
        else data += '&' + arg
    })
    return data
}

function parse(curl) {
    const newlineFound = /\r|\n/.exec(curl)
    if (newlineFound) {
        // remove newlines
        curl = curl.replace(/\\\r|\\\n/g, '')
    }
    // yargs parses -XPOST as separate arguments. just prescreen for it.
    curl = curl.replace(/ -XPOST/, ' -X POST')
    curl = curl.replace(/ -XGET/, ' -X GET')
    curl = curl.replace(/ -XPUT/, ' -X PUT')
    curl = curl.replace(/ -XPATCH/, ' -X PATCH')
    curl = curl.replace(/ -XDELETE/, ' -X DELETE')
    curl = curl.trim()

    const parsedArgs = yargs(curl).argv
    let cookieString
    let cookies
    let url = parsedArgs._[1]
    // if url argument wasn't where we expected it, try to find it in the other arguments
    if (!url) {
        for (var argName in parsedArgs) {
            if (typeof parsedArgs[argName] === 'string') {
                if (parsedArgs[argName].indexOf('http') === 0 || parsedArgs[argName].indexOf('www.') === 0) {
                    url = parsedArgs[argName]
                }
            }
        }
    }

    const headers = {}
    const parseHeaders = (headerFieldName) => {
        if (parsedArgs[headerFieldName]) {
            if (!Array.isArray(parsedArgs[headerFieldName])) {
                parsedArgs[headerFieldName] = [parsedArgs[headerFieldName]]
            }
            parsedArgs[headerFieldName].map(header => {
                if (header.indexOf('Cookie') > -1) cookieString = header
                const [name, value] = header.split(':')
                headers[name] = (value || '').trim()
            })
        }
    }

    parseHeaders('H')
    parseHeaders('header')
    const ua = parsedArgs.A || parsedArgs['user-agent']
    if (ua) headers['User-Agent'] = ua

    if (parsedArgs.b) cookieString = parsedArgs.b
    else if (parsedArgs.cookie) cookieString = parsedArgs.cookie
    let multipartUploads
    if (parsedArgs.F) {
        multipartUploads = {}
        if (!Array.isArray(parsedArgs.F)) {
            parsedArgs.F = [parsedArgs.F]
        }
        parsedArgs.F.forEach(function (multipartArgument) {
            // input looks like key=value. value could be json or a file path prepended with an @
            var splitArguments = multipartArgument.split('=', 2)
            var key = splitArguments[0]
            var value = splitArguments[1]
            multipartUploads[key] = value
        })
    }
    // if (cookieString) {
    //     const cookieParseOpts = { decode: (s) => s }
    //     cookies = cookie.parse(cookieString.replace('Cookie: ', ''), cookieParseOpts)
    // }
    let method = parsedArgs.X
    if (['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].indexOf(method) > -1) {
        // do nothing
    }
    else if (parsedArgs['d'] ||
        parsedArgs['data'] ||
        parsedArgs['data-binary'] ||
        parsedArgs['F'] ||
        parsedArgs['form']) {
        method = 'POST'
    } else {
        method = 'GET'
    }

    url = trimChar(url, ["'", '"'])
    const urlObj = URL.parse(url)
    // , query = querystring.parse(urlObj.query, null, null, { maxKeys: 1000 })
    // if (Object.keys(query).length > 0) request.query = query

    urlObj.search = null // Clean out the search/query portion.
    var request = {
        // o: urlObj,
        path: urlObj.path,
        baseUrl: URL.format(urlObj),
        url,
        method
    }

    request.headers = headers
    if (cookies) request.cookies = cookies
    if (multipartUploads) request.multipartUploads = multipartUploads
    if (parsedArgs.data) {
        request.data = parsedArgs.data
    } else if (parsedArgs['data-binary']) {
        request.data = parsedArgs['data-binary']
        request.isDataBinary = true
    } else if (parsedArgs['d']) {
        request.data = parsedArgs['d']
    }

    if (parsedArgs['u']) {
        request.auth = parsedArgs['u']
    }
    if (parsedArgs['user']) {
        request.auth = parsedArgs['user']
    }
    if (Array.isArray(request.data)) {
        request.data = joinDataArguments(request.data)
    }

    if (parsedArgs['k'] || parsedArgs['insecure']) {
        request.insecure = true
    }
    return request
}

function trimChar(text, chars) {
    if (!Array.isArray(chars)) {
        if ((chars || '').length === 1) { chars = [chars] }
        else { chars = chars.split('') }
    }
    let last = (text || '').trim()
    chars.map(c => {
        if (last.startsWith(c)) { last = last.slice(1) }
        if (last.endsWith(c)) { last = last.slice(0, last.length - 1) }
    })
    return last
}

module.exports = {
    parse
}


// const cmd = `curl "https://qctest.dev.datumcorp.com/api/journal/-lLhWwJLTMGKnXTvoxPogg?find=1" -X PUT -H 'folderId: AAAAAwAAQACAAAAAAAAAAQ' -H 'Accept: application/json, text/plain, */*' -H 'Referer: http://localhost:4200/journal/-lLhWwJLTMGKnXTvoxPogg/edit' -H 'Origin: http://localhost:4200' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.119 Safari/537.36' -H 'Content-Type: application/json' --data-binary '{"billInfo":"6nKBfEynT4iY7NPXFGrFLQ","handlers":["SmXRvuB6SeCLyIEAWKKD8g"],"date":"2019-02-26T00:00:00.000Z","lines":[{"c":{"id":"9kbG8HFVSK2Omm245Qi6eA","qty":1,"acctid":"yDBPR3XLTmC74a4Q6gRUJg","flags":"","price":300,"amount":300,"data":{"seq":1},"nett":250,"uomId":"fiNq2COHQ1ye7HlBC6JRLw","custom":{},"disc":70,"discRate":0}},{"id":1,"qty":1,"acctid":"yDBPR3XLTmC74a4Q6gRUJg","flags":"B","price":400,"amount":400,"data":{"seq":2},"nett":0,"uomId":"fiNq2COHQ1ye7HlBC6JRLw","taxId":"75yikYYkSuKo1UGgjn3ZDg","disc":0},{"c":{"id":"ieh4aAGySLax_0Dksa4kJw","qty":1,"flags":"F","price":70,"amount":70,"data":{"seq":2,"discount":true},"nett":50,"custom":{},"disc":0,"discRate":0}},{"id":92,"qty":1,"flags":"F","price":40,"amount":40,"data":{"tax":"75yikYYkSuKo1UGgjn3ZDg","seq":2},"nett":0,"disc":0}],"attach":[],"posts":[],"currency":"AAAABAAAQACAABAAAAAAAA","custom":{"term":"AAABAQAAQACAAAAAAAAAAQ","status":{"AAADEAAEQACAAAAAAAAAAQ":42734}},"data":{"billterm":[]},"uts":"2019-02-26T08:21:22.889Z"}' --compressed`
// console.log(parse(cmd))