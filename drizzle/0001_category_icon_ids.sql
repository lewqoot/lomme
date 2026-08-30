-- Categories used to store an emoji in `icon` that nothing rendered, and a pastel
-- `color` used only as a tile fill. Both now hold structured values: `icon` is a
-- lucide id from src/config/icons.ts, `color` is the saturated colour the client
-- also derives the tile tint from.
UPDATE categories SET icon = 'house',           color = '#6B6B6B' WHERE icon = '🏠';
UPDATE categories SET icon = 'heart-pulse',     color = '#07E240' WHERE icon = '💚';
UPDATE categories SET icon = 'popcorn',         color = '#9420F3' WHERE icon = '🎉';
UPDATE categories SET icon = 'utensils',        color = '#EA082E' WHERE icon = '☕️';
UPDATE categories SET icon = 'shopping-basket', color = '#E40F8D' WHERE icon = '🛒';
UPDATE categories SET icon = 'car',             color = '#2971F9' WHERE icon = '🚕';
UPDATE categories SET icon = 'dumbbell',        color = '#256AF3' WHERE icon = '🏋️';
UPDATE categories SET icon = 'graduation-cap',  color = '#8034F8' WHERE icon = '🎓';
UPDATE categories SET icon = 'plane',           color = '#10AAF2' WHERE icon = '✈️';
UPDATE categories SET icon = 'circle-slash-2',  color = '#6B6B6B' WHERE icon = '↻';
UPDATE categories SET icon = 'briefcase',       color = '#07E240' WHERE icon = '💼';
UPDATE categories SET icon = 'gift',            color = '#E40F8D' WHERE icon = '🎁';
UPDATE categories SET icon = 'tag',             color = '#8034F8' WHERE icon = '✨';
UPDATE categories SET icon = 'banknote',        color = '#07E240' WHERE icon = '💰';

-- Anything still holding a non-ascii icon predates the icon set; fall back rather
-- than leaving a value the sprite cannot resolve.
UPDATE categories SET icon = 'circle-slash-2' WHERE icon !~ '^[a-z0-9-]+$';

-- Accounts seeded before this used the literal 'wallet', which is already a valid id.
UPDATE accounts SET icon = 'wallet' WHERE icon !~ '^[a-z0-9-]+$';
