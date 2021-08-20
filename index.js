#!/usr/bin/env node

const { promisify } = require('util')
, arg = require('yargs').argv
, glob = require('tiny-glob')
, fs = require('fs')
, chalk = require('chalk')
, writeAsync = promisify(fs.writeFile)
, stdin = process.stdin
, cleanups = []
, pkg = require('./package.json')

if (stdin.isTTY) console.log(chalk.bold.whiteBright(`pm+ v${pkg.version}`))

if (require.main === module) {
    if (!stdin.isTTY) {
        let piped = ''
        stdin.resume();
        stdin.setEncoding('utf8');
        stdin.on('data', data => piped += data)
        stdin.on('end', _ => curl2Yaml(piped))
        return
    }
    const isRun = arg.run || arg.r
    , isConvert = arg.convert || arg.c

    let ok = isConvert  || isRun
    if (!ok || arg.h) return console.log(`
${chalk.bold.underline.greenBright(`PM+ - arguments required`)}

To convert files:
- pm+ --convert "*.(json|yaml)"

To run tests:
- pm+ --run "file|pattern" [--exclude "pattern"] [-u URL]

* run newman tests on given URL as {{domain}}
* URL defaults to ${chalk.yellowBright(process.env.PMURL || 'http://localhost:3000')}
  (use "set PMURL=https://..." or "unset PMURL")

Shorthands:
-c --convert
-r --run
-x --exclude


${chalk.bold.yellowBright(`WARNING:`)} This utility will overwrite files without notice.
`)

    if (process.platform === "win32") {
        require("readline")
        .createInterface({
            input: process.stdin,
            output: process.stdout
        })
        .on('SIGINT', _ => process.emit('SIGINT'))
    }

    process.on('SIGINT', _ => {
        // console.log('Cleanup', cleanups.join(' '))
        while (cleanups.length > 0) {
            const f = cleanups.splice(0, 1)[0]
            fs.unlinkSync(f)
        }
        //graceful shutdown
        process.exit()
    })

    // tpl - nunjucks template for tests functions
    // @include(tests from nunjucks template)
    // pm+ docs
    // pm+ clean < curl

    const opts = {
        domain: arg.u || process.env.PMURL,
        exclude: arg.x || arg.exclude,
        isConvert, isRun
    }
    if (opts.exclude && opts.exclude.startsWith('/') && opts.exclude.endsWith('/')) {
        const { trimChar } = require('./lib/curl')
        opts.exclude = RegExp(trimChar(opts.exclude,'/'))
    }
    go(arg.r || arg.run || arg.c || arg.convert, opts)
}

// exclude -> string | regexp
async function go(pattern, { domain, isConvert, isRun, exclude, returnValue }) {
    // console.log('start', { pattern, domain, exclude })
    const t = +new Date()
    const { loadJson, loadYaml } = require('./lib/pmcollection')
    const { run } = require('./lib/runner')

    // default exclude files begins with !
    if (!exclude && !pattern.startsWith('!')) exclude = /\!.*/

    const f = await glob(pattern)
    // return console.log(f.join('\n'))
    const files = await f.filter(r => {
        // console.log(r)
        if (typeof exclude === 'string' && r.indexOf(exclude) > -1) return false
        else if (exclude instanceof RegExp && exclude.test(r)) return false
        return true
    }).reduce(async (p, f) => {
        p = await p
        if (f.endsWith('.json')) {
            if (isConvert) await loadJson(f)
            p.push(f)
        }
        else if (f.endsWith('.yaml')) {
            const fn = await loadYaml(f, isRun)
            if (fn) {
                p.push(fn)
                cleanups.push(fn)
            }
        }
        return p
    }, Promise.resolve([]))

    if (isRun) {
        const env = {
            values: [{
                enabled: true,
                key: 'domain',
                value: domain || 'http://localhost:3000',
                type: 'text'
            }]
        }

        return run(env, files).then(errors => {
            // cleanup temp files
            // if (cleanups.length) console.log('\nCleanups')
            while (cleanups.length > 0) {
                const f = cleanups.splice(0, 1)[0]
                // console.log(' -', f)
                fs.unlinkSync(f)
            }
            if (!returnValue) {
                console.log('')
                if (files.length) console.log(`Took ${+new Date() - t}ms for ${files.length} files`)
                if (errors.total) {
                    console.error(chalk.yellow(`${errors.total} errors found!`))
                    errors.files.map(f =>  {
                        if (!f.total) return
                        console.log(' -', f.total ? '❌ ' : '✔️ ', f.name)
                        // if (f.fails)
                        let lastSrc = ''
                        f.fails.map(ff => {
                            const src = ff.source.name
                            if (lastSrc !== src) {
                                lastSrc = src
                                console.log('  •', chalk.yellowBright(src))
                            }
                            console.log(chalk.redBright('  ⓧ ->'), ff.error.test || ff.error.message)
                        })
                    })
                }
                else if (files.length) {
                    console.info(chalk.greenBright('👍  Yay! All tests passed.'))
                }
                else console.warn('Nothing to run?')
                process.exit(errors ? 1 : 0)
            }
            return errors
        })
    }
}

async function convert(pattern) {
    return await go(pattern, { isConvert: true, returnValue: true })
}

async function run(pattern, { url, exclude }) {
    return await go(pattern, { isRun: true, domain: url, exclude, returnValue: true })
}

async function curl2Yaml(curlCommand) {
    const { isJsonContent, makeYaml } = require(`./lib/pmcollection`)
    const curl = require('./lib/curl')
    const p = curl.parse(curlCommand)
    , cleanHeaders = ['accept-language', 'authority', 'origin', 'cookie', 'user-agent']
    , cleaned = {}

    Object.keys(p.headers).map(k => {
        if (k.startsWith('sec-') || cleanHeaders.includes(k)) return
        cleaned[k] = p.headers[k]
    })
    p.headers = cleaned

    const step = {
        [p.method]: `{{domain}}${p.path}`,
        headers: p.headers,
        prerequest: '',
        test: ''
    }
    if (p.data) {
        if (isJsonContent(p.headers)) {
            p.data = JSON.stringify(JSON.parse(p.data), null, 2)
        }
        step.body = { raw: p.data }
    }

    const dump = makeYaml({
        name: `curl_${+new Date()}`,
        steps: [{
            [`Give this request a name`]: step
        }]
    })
    console.log(dump)
    // const fn = `curl_${+new Date()}.yaml`
    // await writeAsync(fn, dump)
    // console.log(`👍  ${fn} saved`)
}

module.exports = {
    curl2Yaml,
    convert,
    run
}
// return loadYaml('test.yaml')

// ROADMAP
// - convert CURL to YAML https://github.com/tj/parse-curl.js
// - add sequence tests
// - add yaml test - template