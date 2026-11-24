from copy import deepcopy
from django.db import migrations, models


def allow_retired_copies(apps, schema_editor):
    database = schema_editor.connection.database
    if 'book_copies' not in database.list_collection_names():
        return
    validator = deepcopy(database['book_copies'].options().get('validator', {}))
    status = validator.get('$jsonSchema', {}).get('properties', {}).get('status', {})
    if 'enum' in status and 'retired' not in status['enum']:
        status['enum'].append('retired')
        database.command('collMod', 'book_copies', validator=validator)


class Migration(migrations.Migration):
    dependencies = [('library', '0009_allow_optional_review_comment')]
    operations = [
        migrations.AlterField(model_name='review', name='comment', field=models.CharField(blank=True, max_length=500)),
        migrations.RunPython(allow_retired_copies, migrations.RunPython.noop),
    ]
