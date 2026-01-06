# PM+ Utility

Productivity tools for those who worked on postman collections.

This tool is designed to convert existing JSON (collection) files to YAML format, with a little restructuring of the schema.

### How To Use

Install via `npm i -g pm-plus`

Then go to the directory with postman collections and then type `pm+ -c '*.json'`

To run both json and yaml use: `pm+ -r "*.{json,yaml}"`

> Or for development mode, git clone this repo and then run `npm i && npm link`

The end result is to have maintainable code which is easy to review and edit, without the need for the Postman App.

```yaml
name: Sample Postman Collection
description: A sample collection to demonstrate collections as a set of related requests
ver: 1.0.0
steps:
  - A simple GET request:
      GET: 'https://postman-echo.com/get?source=newman-sample-github-collection'
      headers: {}
      body: {}
      test: |-
        pm.test('expect response be 200', function () {
            pm.response.to.be.ok
        })
        pm.test('expect response json contain args', function () {
            pm.expect(pm.response.json().args).to.have.property('source')
              .and.equal('newman-sample-github-collection')
        })
```

instead of JSON

```json
{
  "info": {
    "name": "Sample Postman Collection",
    "schema": "https://schema.getpostman.com/json/collection/v2.0.0/collection.json"
  },
  "item": [
    {
      "name": "A simple GET request",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('expect response be 200', function () {",
              "    pm.response.to.be.ok",
              "})",
              "pm.test('expect response json contain args', function () {",
              "    pm.expect(pm.response.json().args).to.have.property('source')",
              "      .and.equal('newman-sample-github-collection')",
              "})"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "header": [],
        "body": {},
        "method": "GET",
        "url": {
          "raw": "https://postman-echo.com/get?source=newman-sample-github-collection",
          "host": [
            "https:"
          ],
          "path": [
            "",
            "postman-echo.com",
            "get?source=newman-sample-github-collection"
          ]
        }
      }
    },...
```

### Functionalities

- `pm+ --convert pattern.(json|yaml)` convert between JSON and YAML format
- `pm+ --run pattern.(json|yaml) [-u URL]` run file in newman, optionally providing URL as `domain` variable
- `pm+ < curl.txt` convert from curl command to YAML

Also included some handy macros: `set, clear, include` for the YAML file.

List the steps in a test file
`pm+ -l file `

Run specific steps, not all steps in a file
`pm+ -r file -s=[1,2,3]`

### Variables

This is a shorthand equivalent to `pm.variables.set()`

`set()` step
```yaml
  - set('key', value)
```

`clear()` step - to clear the variable set earlier
```yaml
  - clear()  # clears all
  - clear(v1, v2) # only clear v1 and v2
```

### External Test Files

`include()` steps from another test file
```yaml
steps:
  - include(file[,step,step])  # no need .yaml or .json file extension
    # by index, starts with step 1
    # Name of step
```
The include files also is recursive, meaning that the included file may also contain its own `include()` steps.

The include function requires the filename, and path is relative to the test file.

Examples:
```yaml
steps:
  - include(shared/login)
    # by index, starts with step 1
    # Name of step
```
### Shared Scripts

Tired of writing the same file and postman not allowing to require external files?

We have also added `include:` directive support to import scripts. Note that this is not the same as the `include()` test files.

```yaml
steps:
  - Login as Admin:
      POST: '{{domain}}/api/user/login'
      headers:
        Content-Type: application/json
      include:
        - path/file1.js
        - path/file2.js
      prerequest: ...
```

The included files must be javascript files which will be added to the `prerequest` and `test` scripts.


### Using as Module

```js
import { convert, run } from 'pm-plus'

convert('*.json').then(...)

run('*.json', { url: 'https://...', exclude: 'string | regex' }).then(...)
```

- exclude (optional): to filter files from the glob pattern based on string (contains) or regex
- url (optional): behaves the same as in command line

### Roadmap

- add pmconf for default URL

### License

[MIT](LICENSE)
