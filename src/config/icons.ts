import { LIBRARY_ICON_IDS } from './generated-icon-library.ts'

// The category icon set, grouped the way the picker presents it. Group order and
// contents mirror the reference app, which offers twenty-one themed sections
// rather than a single flat list.
// Every id is a lucide icon name; the build turns this list into an SVG sprite,
// so adding an icon here is the only step needed to ship it.
export const ICON_GROUPS: ReadonlyArray<{ label: string; icons: readonly string[] }> = [
  { label: 'Еда', icons: [
    'utensils', 'utensils-crossed', 'coffee', 'cup-soda', 'pizza', 'sandwich',
    'salad', 'soup', 'beef', 'fish', 'egg', 'croissant',
    'cake', 'cake-slice', 'ice-cream-cone', 'ice-cream-bowl', 'cookie', 'candy',
    'donut', 'apple', 'banana', 'cherry', 'grape', 'carrot',
    'wheat', 'milk', 'beer', 'wine', 'martini', 'popcorn',
    'popsicle', 'ham', 'drumstick', 'shopping-basket', 'hamburger', 'hop',
    'bean', 'citrus', 'nut', 'dessert',
  ] },
  { label: 'Транспорт', icons: [
    'car', 'car-front', 'car-taxi-front', 'bus', 'bus-front', 'train-front',
    'train-track', 'tram-front', 'plane', 'plane-takeoff', 'ship', 'sailboat',
    'bike', 'scooter', 'truck', 'fuel', 'parking-meter', 'traffic-cone',
    'navigation', 'map', 'map-pin', 'route', 'anchor', 'caravan',
    'forklift', 'ambulance', 'helicopter', 'footprints', 'luggage',
  ] },
  { label: 'Покупки', icons: [
    'shopping-bag', 'shopping-cart', 'store', 'tag', 'tags', 'gift',
    'package', 'package-open', 'receipt', 'ticket', 'shirt', 'glasses',
    'watch', 'gem', 'crown', 'baby', 'handbag', 'boxes',
    'barcode', 'scan-barcode', 'wallet-cards', 'percent', 'badge-percent', 'vault',
  ] },
  { label: 'Развлечения', icons: [
    'popcorn', 'film', 'clapperboard', 'tv', 'tv-minimal', 'music',
    'music-2', 'headphones', 'mic', 'mic-vocal', 'guitar', 'piano',
    'drum', 'disc', 'disc-3', 'gamepad', 'gamepad-2', 'joystick',
    'dices', 'party-popper', 'ferris-wheel', 'theater', 'drama', 'palette',
    'brush', 'camera', 'video', 'radio', 'podcast', 'book-open',
  ] },
  { label: 'Здоровье', icons: [
    'heart-pulse', 'heart', 'activity', 'stethoscope', 'pill', 'syringe',
    'bandage', 'thermometer', 'cross', 'hospital', 'brain', 'bone',
    'ear', 'eye', 'dna', 'microscope', 'shield-plus', 'hand-heart',
    'leaf',
  ] },
  { label: 'Спорт', icons: [
    'dumbbell', 'bike', 'volleyball', 'trophy', 'medal', 'award',
    'target', 'goal', 'waves', 'mountain-snow', 'tent', 'flame',
    'timer', 'flag-triangle-right', 'swords', 'rocket',
  ] },
  { label: 'Дом', icons: [
    'house', 'house-plus', 'sofa', 'bed', 'bed-double', 'lamp',
    'lamp-desk', 'lightbulb', 'armchair', 'door-open', 'door-closed', 'blinds',
    'bath', 'shower-head', 'toilet', 'washing-machine', 'refrigerator', 'microwave',
    'cooking-pot', 'utensils-crossed', 'hammer', 'paint-roller', 'key', 'key-round',
    'trash-2', 'archive', 'boxes', 'cctv',
  ] },
  { label: 'Коммунальные услуги', icons: [
    'zap', 'plug', 'plug-zap', 'droplet', 'droplets', 'flame',
    'wifi', 'router', 'antenna', 'thermometer-sun', 'snowflake', 'fan',
    'battery-charging', 'gauge', 'globe', 'signal', 'phone-call', 'satellite-dish',
  ] },
  { label: 'Красота', icons: [
    'scissors', 'sparkles', 'sparkle', 'brush', 'paintbrush', 'spray-can',
    'bath', 'flower', 'flower-2', 'gem', 'glasses', 'wand',
    'wand-sparkles', 'venus', 'hand', 'smile',
  ] },
  { label: 'Дети', icons: [
    'baby', 'blocks', 'puzzle', 'toy-brick', 'rocket', 'bird',
    'rabbit', 'school', 'backpack', 'pencil', 'pen-tool', 'shapes',
    'candy', 'balloon',
  ] },
  { label: 'Образование', icons: [
    'graduation-cap', 'book', 'book-open', 'book-marked', 'library', 'notebook',
    'notebook-pen', 'pencil', 'pen', 'ruler', 'calculator', 'flask-conical',
    'atom', 'microscope', 'languages', 'presentation', 'school', 'award',
    'lightbulb', 'brain',
  ] },
  { label: 'Финансы', icons: [
    'wallet', 'wallet-cards', 'banknote', 'coins', 'credit-card', 'piggy-bank',
    'landmark', 'receipt', 'receipt-text', 'calculator', 'chart-line', 'chart-pie',
    'chart-column', 'trending-up', 'trending-down', 'percent', 'scale', 'handshake',
    'briefcase-business', 'circle-dollar-sign', 'hand-coins', 'badge-dollar-sign', 'vault',
  ] },
  { label: 'Криптовалюта', icons: [
    'bitcoin', 'currency', 'circle-dollar-sign', 'coins', 'hexagon', 'database',
    'server', 'cpu', 'key-round', 'lock', 'shield-check', 'wallet',
    'link', 'blocks', 'network', 'binary',
  ] },
  { label: 'Здания', icons: [
    'building', 'building-2', 'hotel', 'factory', 'warehouse', 'church',
    'castle', 'landmark', 'store', 'hospital', 'school', 'house',
    'tent-tree', 'fence', 'construction',
  ] },
  { label: 'Люди', icons: [
    'user', 'users', 'user-round', 'users-round', 'user-plus', 'user-check',
    'contact', 'baby', 'person-standing', 'accessibility', 'handshake', 'heart-handshake',
    'smile', 'venus-and-mars', 'id-card', 'circle-user',
  ] },
  { label: 'Устройства', icons: [
    'smartphone', 'tablet', 'laptop', 'monitor', 'tv', 'keyboard',
    'mouse', 'printer', 'camera', 'headphones', 'watch', 'speaker',
    'hard-drive', 'usb', 'battery', 'plug', 'router', 'webcam',
    'gamepad-2', 'server',
  ] },
  { label: 'Инструменты', icons: [
    'hammer', 'wrench', 'drill', 'axe', 'ruler', 'pencil-ruler',
    'paintbrush', 'paint-roller', 'pickaxe', 'shovel', 'scissors', 'settings',
    'cog', 'construction', 'hard-hat',
  ] },
  { label: 'Природа', icons: [
    'leaf', 'trees', 'tree-pine', 'tree-palm', 'flower', 'flower-2',
    'sprout', 'sun', 'moon', 'cloud', 'cloud-rain', 'cloud-snow',
    'snowflake', 'wind', 'rainbow', 'mountain', 'waves', 'droplet',
    'sunrise', 'sunset', 'star', 'earth',
  ] },
  { label: 'Животные', icons: [
    'dog', 'cat', 'bird', 'fish', 'rabbit', 'turtle',
    'snail', 'bug', 'squirrel', 'rat', 'worm', 'shell',
    'feather', 'paw-print', 'egg', 'beef',
  ] },
  { label: 'Фигуры', icons: [
    'circle', 'square', 'triangle', 'diamond', 'hexagon', 'pentagon',
    'octagon', 'star', 'heart', 'shapes', 'box', 'cylinder',
    'cone', 'pyramid', 'torus', 'spline',
  ] },
  { label: 'Другое', icons: [
    'circle-slash-2', 'sparkles', 'gift', 'bell', 'flag', 'bookmark',
    'pin', 'paperclip', 'folder', 'file', 'clock', 'calendar',
    'calendar-days', 'repeat', 'refresh-cw', 'recycle', 'umbrella', 'shield',
    'compass', 'globe', 'rocket', 'anchor', 'magnet', 'puzzle',
    'infinity', 'asterisk',
  ] },
]

// Icons that older categories may still reference. They are no longer offered in
// the picker but must stay in the sprite, or a stored category renders as a gap.
const LEGACY_ICON_IDS: readonly string[] = [
  'utensils', 'coffee', 'hamburger', 'pizza', 'salad', 'soup', 'sandwich', 'croissant', 'cake', 'ice-cream-cone', 'candy', 'apple', 'cherry', 'grape', 'carrot', 'egg', 'fish', 'drumstick', 'beef', 'milk', 'wine', 'beer', 'martini', 'chef-hat', 'car', 'car-taxi-front', 'bus', 'train-front', 'bike', 'plane', 'ship', 'truck', 'fuel', 'parking-meter', 'traffic-cone', 'route', 'map-pin', 'compass', 'anchor', 'house', 'sofa', 'bed-double', 'lamp', 'bath', 'shower-head', 'washing-machine', 'plug', 'zap', 'droplets', 'flame', 'wifi', 'tv', 'wrench', 'hammer', 'paintbrush', 'key', 'lock', 'trees', 'sprout', 'flower-2', 'recycle', 'heart-pulse', 'activity', 'pill', 'stethoscope', 'syringe', 'hospital', 'ambulance', 'bandage', 'brain', 'eye', 'cross', 'glasses', 'dumbbell', 'scissors', 'smile', 'popcorn', 'clapperboard', 'gamepad-2', 'music', 'headphones', 'guitar', 'disc-3', 'radio', 'mic-vocal', 'ticket', 'party-popper', 'dice-5', 'puzzle', 'drama', 'venetian-mask', 'palette', 'camera', 'book', 'trophy', 'medal', 'cigarette', 'shopping-basket', 'shopping-cart', 'shopping-bag', 'store', 'package', 'tag', 'gift', 'shirt', 'baby', 'dog', 'cat', 'paw-print', 'bone', 'banknote', 'dollar-sign', 'coins', 'piggy-bank', 'wallet', 'credit-card', 'landmark', 'receipt', 'trending-up', 'percent', 'hand-coins', 'circle-dollar-sign', 'calculator', 'banknote-arrow-up', 'banknote-arrow-down', 'scale', 'shield', 'briefcase-business', 'calendar-check', 'badge-percent', 'laptop', 'badge-russian-ruble', 'graduation-cap', 'hand-helping', 'heart-handshake', 'receipt-russian-ruble', 'chart-no-axes-combined', 'house-plus', 'undo-2', 'handshake', 'tags', 'circle-plus', 'briefcase', 'school', 'notebook-pen', 'monitor', 'building-2', 'phone', 'smartphone', 'globe', 'cloud', 'file-text', 'users', 'luggage', 'tent', 'mountain-snow', 'palmtree', 'umbrella', 'sun', 'waves', 'hand-heart', 'arrow-right-left', 'repeat'
]

export const ICON_IDS: readonly string[] = [...new Set([
  ...ICON_GROUPS.flatMap((group) => group.icons),
  ...LEGACY_ICON_IDS,
  ...LIBRARY_ICON_IDS,
])]
export const FALLBACK_ICON = 'circle-slash-2'

/**
 * Icons inlined into the document. Everything else lives in a sprite fetched when
 * it is first needed: the full set is 432 symbols and made up 98% of index.html,
 * which every cold start paid for even though a wallet typically shows a dozen.
 */
export const CORE_ICON_IDS: readonly string[] = [
  'shopping-basket', 'utensils', 'shopping-bag', 'popcorn', 'activity', 'dumbbell',
  'car', 'house', 'graduation-cap', 'plane', 'repeat', 'circle-slash-2', 'banknote', 'gift',
  'wallet', 'briefcase-business', 'heart-pulse', 'coffee', 'bus', 'pill',
]
