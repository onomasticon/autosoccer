-- Article slugs cut at 60 characters could end in a hyphen, giving "--" before the id suffix.
-- Those slugs violate the API's slug contract, and one of them made the whole article list fail.
update articles set slug = regexp_replace(slug, '-{2,}', '-', 'g') where slug ~ '-{2,}';
