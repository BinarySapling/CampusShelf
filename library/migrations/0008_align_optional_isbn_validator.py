from copy import deepcopy
from django.db import migrations


def allow_missing_isbn(apps, schema_editor):
    # The legacy Atlas validator predates the nullable Django ISBN field.
    database = schema_editor.connection.database
    if 'books' not in database.list_collection_names():
        return
    validator = deepcopy(database['books'].options().get('validator', {}))
    isbn = validator.get('$jsonSchema', {}).get('properties', {}).get('isbn')
    if not isbn or 'bsonType' not in isbn:
        return
    types = isbn['bsonType']
    types = [types] if isinstance(types, str) else list(types)
    if 'null' not in types:
        isbn['bsonType'] = types + ['null']
        database.command('collMod', 'books', validator=validator)


class Migration(migrations.Migration):
    dependencies = [('library', '0007_book_cover_url')]
    operations = [migrations.RunPython(allow_missing_isbn, migrations.RunPython.noop)]
