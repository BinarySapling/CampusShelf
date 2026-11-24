from copy import deepcopy
from django.db import migrations


def allow_optional_review_comment(apps, schema_editor):
    database = schema_editor.connection.database
    if 'reviews' not in database.list_collection_names():
        return
    validator = deepcopy(database['reviews'].options().get('validator', {}))
    comment = validator.get('$jsonSchema', {}).get('properties', {}).get('comment')
    if comment is not None and comment.get('minLength', 0) > 0:
        comment['minLength'] = 0
        database.command('collMod', 'reviews', validator=validator)


class Migration(migrations.Migration):
    dependencies = [('library', '0008_align_optional_isbn_validator')]
    operations = [migrations.RunPython(allow_optional_review_comment, migrations.RunPython.noop)]
