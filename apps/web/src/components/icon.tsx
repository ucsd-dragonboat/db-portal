import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown, faArrowUp, faBars, faCakeCandles, faCalendarDays, faCar, faChair, faCheck, faChevronRight,
  faCircleCheck, faCircleExclamation, faCircleQuestion, faCircleXmark, faClipboardList, faClone, faCrown,
  faEllipsisVertical,
  faBullhorn, faDragon, faEye, faFileLines, faFlagCheckered, faFolder, faGear, faHand, faHouse, faLink, faLocationDot,
  faMagnifyingGlass, faMoon, faPen, faPhone, faPlus, faSailboat, faSun, faTableCells, faThumbtack, faTrashCan,
  faTriangleExclamation, faUser, faUsers, faWeightScale, faXmark,
} from "@fortawesome/free-solid-svg-icons";

/** Central icon registry (Font Awesome free/solid) — semantic names so call sites read like the old emojis. */
export const ICONS = {
  announce: faBullhorn,      // 📣
  board: faThumbtack,        // 📌
  boat: faSailboat,           // 🛶 lineups
  calendar: faCalendarDays,   // 🗓 events
  car: faCar,                 // 🚗 rides
  check: faCheck,             // ✓
  chevron: faChevronRight,
  clone: faClone,             // ⧉ duplicate
  crown: faCrown,             // 👑 driver
  dots: faEllipsisVertical,   // ⋮ menu
  down: faArrowDown,          // ↓
  dragon: faDragon,           // 🐉 logo
  due: faCircleExclamation,   // ‼ due
  eye: faEye,                 // 👁 preview
  file: faFileLines,          // 🧾
  folder: faFolder,           // 📁 Drive-style event folders
  form: faClipboardList,      // 📝 forms
  gear: faGear,               // ⚙️
  hand: faHand,               // 🙋 needs a ride
  house: faHouse,             // 🏠 address
  link: faLink,               // 🔗 copy link
  maybe: faCircleQuestion,    // 🤔
  menu: faBars,               // ☰
  moon: faMoon,               // 🌚 attendance
  no: faCircleXmark,          // ❌
  party: faCakeCandles,       // 🎉 social
  pen: faPen,                 // ✎ edit
  phone: faPhone,             // 📞
  pin: faLocationDot,         // 📍 location
  plus: faPlus,               // ＋
  race: faFlagCheckered,      // 🏁 race
  search: faMagnifyingGlass,
  seat: faChair,              // 💺 seats
  table: faTableCells,        // ▦
  sun: faSun,                 // 🌝 attendance
  trash: faTrashCan,          // 🗑 delete
  up: faArrowUp,              // ↑
  user: faUser,               // 👤
  users: faUsers,             // 👥
  warn: faTriangleExclamation,
  weight: faWeightScale,      // ⚖️ 🏆 weight
  x: faXmark,                 // ✕ close/remove
  yes: faCircleCheck,         // ✅
} as const;

export type IconName = keyof typeof ICONS;

/** <Icon name="car" /> — sized to the surrounding text, slightly muted vertical alignment like the emojis were. */
export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return <FontAwesomeIcon icon={ICONS[name]} className={className} style={{ width: "1em" }} fixedWidth />;
}
