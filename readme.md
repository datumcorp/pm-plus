# PM+ Utility

Productivity tools for those who worked on postman collections.

This tool is designed to convert existing JSON (collection) files to YAML format, with a little restructuring of the schema.

The end result is to have maintainable code which is easy to review and edit, without the need for the Postman App.

Also included some handy macros: `set, clear, include`

```yaml
name: sample test file
schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
steps:
  - set(username = admin, age = 1)
  - include(common-tests.yaml, login)
  - clear()
  - other steps:
      GET: '{{domain}}/f/{{newFileId}}/meta'
      headers:
        Content-Type: application/json
      body:
```