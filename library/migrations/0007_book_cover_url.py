from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [('library', '0006_libraryspace_spacebooking')]
    operations = [migrations.AddField(model_name='book', name='cover_url', field=models.URLField(blank=True, max_length=1000))]
