from stemcraft_lib.ids import album_dirname, new_album_id, new_song_id, slugify, song_dirname


def test_ids_are_unique_and_time_sortable():
    ids = [new_song_id() for _ in range(50)]
    assert len(set(ids)) == 50
    assert ids == sorted(ids)
    assert all(len(i) == 26 for i in ids)


def test_slugify_handles_punctuation_unicode_and_case():
    assert slugify("Björk — Army of Me!") == "bjork-army-of-me"
    assert slugify("  multiple   spaces  ") == "multiple-spaces"
    assert slugify("///") == "untitled"


def test_slug_is_bounded_so_paths_stay_sane():
    assert len(slugify("a" * 200)) <= 60


def test_dirname_pairs_id_with_slug():
    assert song_dirname("01J9Z3K8Q4ABCDEFGHJKMNPQRS", "My Song") == (
        "01J9Z3K8Q4ABCDEFGHJKMNPQRS-my-song"
    )


def test_album_id_is_a_ulid_and_unique():
    first, second = new_album_id(), new_album_id()
    assert len(first) == 26
    assert first != second


def test_album_dirname_is_id_then_slug():
    assert album_dirname("01J0", "Kind of Blue!") == "01J0-kind-of-blue"


def test_album_dirname_survives_a_title_with_no_usable_characters():
    # Same fallback as song_dirname: the id still names the folder.
    assert album_dirname("01J0", "!!!") == "01J0-untitled"
