const chalk = require('chalk')
, _path = process.cwd()
, fs = require('fs')
, contentDisposition = require('content-disposition')

function run(env, files) {
    let errors = { total: 0, files: [] }
    return (files || []).reduce((cur, file) => cur.then(_ => {
        // we load collection using require
        // for better validation and handling
        let c = require(`${_path}/${file}`)
        // , name = ''
        // if (c && c.info) { name = c.info.name }
        console.log(`\n${chalk.bold.underline.whiteBright(`## ${file}`)}`)
        validate(c, file, _path)

        // run sequentially
        return runTest({ collection: c, environment: env }).then(res => {
            errors.total += res.fails.length || 0
            errors.files.push({
                name: file,
                fails: res.fails,
                stats: res.stats,
                total: res.fails.length ? 1 : 0
            })
        })
    }), Promise.resolve(0))
    .then(() => new Promise(done => {
        // if (errors) console.error(`\n     ${chalk.bold.underline.red(`!!! ${errors} ERRORS !!!`)}`)
        setTimeout(() => done(errors), 300)
    }))
}

async function runTest({ collection, environment }) {
    const newman = require('newman')
    return new Promise(done => {
        newman.run({ collection, environment,
            // bail: true,
            ignoreRedirects: true,
            reporters: ['cli'],
            reporter: {
                cli: {
                    // noAssertions: true,
                    noFailures: true,
                    noSummary: true,
                    // silent: true
                }
            }
        })
        .on('request', function (error, args) {
            if (error) return

            const content = args.response.headers.reference['content-disposition'] || {}
            if (!content.value || !content.value.startsWith('attachment;')) return

            const disposition = contentDisposition.parse(content.value)

            fs.writeFile(`${slugify(args.item.name)}-${disposition.parameters.filename}`, args.response.stream, (error) => {
                if (error) console.error(error)
            })
        })
        .on('done', (error, summary) => {
            // console.info(`   ${err ? chalk.red('✖') : chalk.green('✓')}  ${collection.info.name}  ${err ? chalk.red(err.name) : ''}`)
            // console.error(summary.run.failures)
            // summary.run.failures.map(fail => {
            //     const e = fail.error
            //     if (!e.test && e.message) console.error('  ', chalk.yellow(e.message))
            // })
            done({
                error, fails: summary.run.failures,
                stats: summary.run.executions.map(ex => ({ name: ex.item.name, time: ex.response.responseTime, size: ex.response.responseSize }))
            })
        })
    })
}

function validate(c, colFile) {
    let notGood = false, first = true
    let items = c.item;
    if (!c.info || !c.info.schema) throw Error('Invalid collection format - require postman collection v2.1')
    items.map(o => {
        let msg = ''
        if (!o.request || !o.request.url) {
            if (first) { console.log(''); first = false }
            console.log(chalk.gray(' skipping   ' + o.name))
            return false
        }

        if (o.request.body.mode === 'formdata') {
            //Form data has file element
            o.request.body.formdata
            .filter(e => e.type === 'file')
            .map(fdElem => {
                let fileWOExt = colFile.slice(0, -5) // remove .json from filename
                //let folderExits = fs.existsSync(`${path}/${fileWOExt}`);
                const fn = fdElem.src || fdElem.description
                const fpath = `${_path}/${fileWOExt}`
                let ffn = `${fpath}/${fn}`
                let mockFileExists = fs.existsSync(ffn)
                if (!mockFileExists) {
                    ffn = `${_path}/${fn}`
                    mockFileExists = fs.existsSync(ffn)
                }

                // Make folder for collection if it uses request body contains mock file
                // And mock file exit
                fdElem.enabled = false
                if (mockFileExists) {
                    console.log(' - found', fn)
                    fdElem.src = ffn
                    fdElem.enabled = true
                }
                else {
                    msg += `   - File not found: ${ffn}\n`;
                }
            })
        }

        if (o.name.startsWith('http')) { msg += `   - add meaningful name\n` }

        const url = o.request.url.raw || o.request.url
        if (!url.startsWith('{{domain}}')) { msg += `   - {{domain}} not found in url\n` }

        if (!o.event || !o.event.filter(ev => ev.listen === 'test').length) {
            if (o.name.toLowerCase() !== 'login') msg += `   - No tests found!\n`
        }
        if (msg.length) {
            msg = chalk.red(` ❗  ${o.name}\n`) + msg
            if (first) { msg = '\n' + msg; first = false }
            console.log(msg)
            notGood = true
        }
    })
    if (notGood) {
        //console.error(issues)
        return false
    }
    return true
}

const SLUGIFY_STRIP_RE = /[^a-zA-Z0-9\-\._]/g
const SLUGIFY_HYPHENATE_RE = /[-\s]+/g
function slugify(s) {
  s = s.replace(SLUGIFY_STRIP_RE, '').trim().toLowerCase()
  s = s.replace(SLUGIFY_HYPHENATE_RE, '-')
  return s
}

module.exports = {
    run
}