from django.db import migrations


def allow_null_references(apps, schema_editor):
    database = schema_editor.connection.database
    fields_by_collection = {
        "book_copies": ["current_member_id"],
        "borrowings": ["book_id", "member_id"],
        "reviews": ["book_id", "member_id"],
    }

    for collection_name, field_names in fields_by_collection.items():
        collection_info = next(
            database.list_collections(filter={"name": collection_name}),
            None,
        )
        if not collection_info:
            continue

        validator = collection_info.get("options", {}).get("validator", {})
        properties = validator.get("$jsonSchema", {}).get("properties", {})
        changed = False
        for field_name in field_names:
            field_rules = properties.get(field_name)
            if not field_rules or "bsonType" not in field_rules:
                continue
            bson_types = field_rules["bsonType"]
            allowed_types = bson_types if isinstance(bson_types, list) else [bson_types]
            if "null" not in allowed_types:
                field_rules["bsonType"] = allowed_types + ["null"]
                changed = True

        if changed:
            database.command({
                "collMod": collection_name,
                "validator": validator,
            })


class Migration(migrations.Migration):
    dependencies = [
        ("library", "0003_alter_member_password_hash"),
    ]

    operations = [
        migrations.RunPython(allow_null_references, migrations.RunPython.noop),
    ]

