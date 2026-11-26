const ZONE_NAMES: Record<string, string> = { "Asia/Ho_Chi_Minh": "越南时间", "Asia/Shanghai": "中国时间", "Asia/Bangkok": "泰国时间", "Asia/Jakarta": "印尼西部时间", "Asia/Manila": "菲律宾时间", "Asia/Singapore": "新加坡时间", "Asia/Tokyo": "日本时间", "Asia/Seoul": "韩国时间" };

export const h3WeeklyZoneLabel = (zone: string) => Object.hasOwn(ZONE_NAMES, zone) ? ZONE_NAMES[zone] : "";
