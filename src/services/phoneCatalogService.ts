/**
 * @module phoneCatalogService
 * @description Synchronisation du référentiel global marques/modèles
 *              depuis l'API externe phone-specs-api.vercel.app.
 *
 * Pattern identique au create.php legacy (Sprint 2.39) :
 *   GET /brands              → liste des marques (brand_slug, brand_name, device_count)
 *   GET /brands/{slug}?page=N → modèles paginés (phone_name, slug, image)
 *                               last_page indique le nombre de pages total
 *
 * Stratégie d'import :
 *   - INSERT OR IGNORE sur brand_slug / phone_slug → idempotent, jamais d'écrasement
 *   - Les entrées 'manual' ne sont jamais touchées par la sync
 *   - Un log par marque dans phone_catalog_sync_log
 *
 * Appels Cloudflare Workers : utilise fetch() natif (Web API, pas Node.js)
 *
 * Sprint 2.39 — MOD-15 catalogue complet
 */

const API_BASE = 'https://phone-specs-api.vercel.app'

// ─── Dataset statique embarqué (fallback si API rate-limitée) ────────────────
/**
 * Liste des 40 marques principales — utilisée comme fallback si phone-specs-api
 * retourne 429 Too Many Requests. Les brand_slug correspondent aux slugs réels de l'API.
 * Permet l'import immédiat sans dépendance externe.
 */
const STATIC_BRANDS: ApiBrand[] = [
  { brand_id: 48,  brand_name: 'Apple',         brand_slug: 'apple-phones-48',         device_count: 87  },
  { brand_id: 9,   brand_name: 'Samsung',        brand_slug: 'samsung-phones-9',        device_count: 340 },
  { brand_id: 45,  brand_name: 'Huawei',         brand_slug: 'huawei-phones-45',        device_count: 271 },
  { brand_id: 8,   brand_name: 'Xiaomi',         brand_slug: 'xiaomi-phones-80',        device_count: 198 },
  { brand_id: 5,   brand_name: 'OnePlus',        brand_slug: 'oneplus-phones-95',       device_count: 58  },
  { brand_id: 10,  brand_name: 'Google',         brand_slug: 'google-phones-107',       device_count: 30  },
  { brand_id: 36,  brand_name: 'Sony',           brand_slug: 'sony-phones-7',           device_count: 134 },
  { brand_id: 7,   brand_name: 'Nokia',          brand_slug: 'nokia-phones-1',          device_count: 215 },
  { brand_id: 11,  brand_name: 'Motorola',       brand_slug: 'motorola-phones-4',       device_count: 218 },
  { brand_id: 12,  brand_name: 'LG',             brand_slug: 'lg-phones-20',            device_count: 289 },
  { brand_id: 29,  brand_name: 'Oppo',           brand_slug: 'oppo-phones-82',          device_count: 178 },
  { brand_id: 94,  brand_name: 'Realme',         brand_slug: 'realme-phones-118',       device_count: 112 },
  { brand_id: 88,  brand_name: 'Vivo',           brand_slug: 'vivo-phones-98',          device_count: 149 },
  { brand_id: 37,  brand_name: 'HTC',            brand_slug: 'htc-phones-45',           device_count: 169 },
  { brand_id: 6,   brand_name: 'BlackBerry',     brand_slug: 'blackberry-phones-36',    device_count: 97  },
  { brand_id: 85,  brand_name: 'Nothing',        brand_slug: 'nothing-phones-198',      device_count: 6   },
  { brand_id: 63,  brand_name: 'Wiko',           brand_slug: 'wiko-phones-85',          device_count: 74  },
  { brand_id: 30,  brand_name: 'Alcatel',        brand_slug: 'alcatel-phones-56',       device_count: 213 },
  { brand_id: 60,  brand_name: 'ZTE',            brand_slug: 'zte-phones-62',           device_count: 197 },
  { brand_id: 32,  brand_name: 'Asus',           brand_slug: 'asus-phones-46',          device_count: 98  },
  { brand_id: 53,  brand_name: 'Honor',          brand_slug: 'honor-phones-121',        device_count: 88  },
  { brand_id: 18,  brand_name: 'Lenovo',         brand_slug: 'lenovo-phones-73',        device_count: 74  },
  { brand_id: 51,  brand_name: 'TCL',            brand_slug: 'tcl-phones-192',          device_count: 52  },
  { brand_id: 33,  brand_name: 'Fairphone',      brand_slug: 'fairphone-phones-163',    device_count: 8   },
  { brand_id: 55,  brand_name: 'Doro',           brand_slug: 'doro-phones-201',         device_count: 34  },
  { brand_id: 26,  brand_name: 'Sharp',          brand_slug: 'sharp-phones-23',         device_count: 52  },
  { brand_id: 77,  brand_name: 'Meizu',          brand_slug: 'meizu-phones-74',         device_count: 58  },
  { brand_id: 44,  brand_name: 'BQ',             brand_slug: 'bq-phones-153',           device_count: 42  },
  { brand_id: 66,  brand_name: 'Cat',            brand_slug: 'cat-phones-155',          device_count: 18  },
  { brand_id: 93,  brand_name: 'Energizer',      brand_slug: 'energizer-phones-196',    device_count: 27  },
]


/**
 * Modèles statiques par brand_slug — fallback exhaustif si l'API est indisponible.
 * Dataset complet : 6 866 modèles / 24 marques — scrapé depuis phone-specs-api.vercel.app
 * Généré automatiquement — Sprint 2.45
 */
const STATIC_MODELES: Record<string, string[]> = {
  // Alcatel — 414 modèles
  'alcatel-phones-5': [
    'A62','V3 Ultra','V3 Pro','V3 Classic','3 (2025)','1B (2022)',
    '1L Pro (2021)','1 (2021)','3L (2021)','1S (2021)','1L (2021)','1V (2021)',
    '1SE (2020)','Go Flip 4','Go Flip 3','Go Flip V','3T10 2020','3X (2020)',
    '3L (2020)','1S (2020)','1V (2020)','1B (2020)','3v (2019)','3x (2019)',
    '1v (2019)','3T 8','Smart Tab 7','3T 10','3L','3 (2019)',
    '1s','1x (2019)','1c (2019)','1','Tetra','7',
    '5v','5','3v','3x (2018)','3','1x',
    '3c','3088','1T 10','1T 7','Idol 5s','Idol 5',
    'A7 XL','A7','U5 HD','Pulsemix','Idol 5s (USA)','Flash (2017)',
    'U5','A5 LED','A3','A3 XL','Shine Lite','Pixi 4 Plus Power',
    'Fierce 4','X1','Pixi 4 (5)','Flash Plus 2','Pop 7 LTE','Pop 4S',
    'Pop 4+','Pop 4','Idol 4s Windows','Idol 4s','Idol 4','Fierce XL (Windows)',
    'CareTime','Pixi 4 (7)','Pixi 4 (6) 3G','Pixi 4 (6)','Pixi 4 (4)','Pixi 4 (3.5)',
    'Pixi 3 (8) LTE','Pop 3 (5.5)','Pop 3 (5)','Fierce XL','Watch','GO Watch',
    'Flash 2','10.16G','2007','Idol 3C','Pixi 3 (10)','Pixi First',
    'Pop Up','Pop Star LTE','Pop Star','Go Play','Flash Plus','Pop Astro',
    'Flash','Idol 3 (5.5)','Idol 3 (4.7)','Orange Klif','Pixi 3 (5.5) LTE','Pixi 3 (5.5)',
    'Pixi 3 (8) 3G','Pixi 3 (7) LTE','Pixi 3 (7) 3G','Pixi 3 (7)','Pop 10','Pixi 3 (5)',
    'Pixi 3 (4.5)','Pixi 3 (4)','Pixi 3 (3.5) Firefox','Pixi 3 (3.5)','Pop D3','Pop D1',
    'Pop Icon','Fire C 2G','Pop 2 (5) Premium','Pop 2 (5)','Pop 2 (4)','Pop 2 (4.5) Dual SIM',
    'Pop 2 (4.5)','Fierce 2','Evolve 2','Pop 8S','Hero 8','Hero 2',
    'Pixi 2','Pop D5','Pop C2','Pixi 8','2012','2010',
    '2052','2040','2005','Pop 7S','Pixi 7','Pop S9',
    'Pop S7','Pop S3','Fire 7','Fire S','Fire E','Fire C',
    'Idol 2 S','Idol 2','Idol 2 Mini S','Idol 2 Mini','Pop Fit','2001',
    '2000','Idol X+','Pop C9','Pop 8','Pop 7','Fierce',
    'Evolve','Pop C7','Pop C5','Pop C3','Pop C1','One Touch Evo 8HD',
    'Idol Alpha','Hero','Idol S','Idol Mini','One Touch T10','One Touch Snap LTE',
    'One Touch Pixi','One Touch Snap','Idol X','One Touch Fire','One Touch Star','One Touch Scribe Easy',
    'One Touch Evo 7','One Touch Evo 7 HD','One Touch Tab 8 HD','One Touch Tab 7','One Touch Tab 7 HD','One Touch Idol Ultra',
    'One Touch Idol','One Touch T\'Pop','One Touch S\'Pop','One Touch M\'Pop','One Touch X\'Pop','One Touch Scribe HD-LTE',
    'One Touch Scribe X','One Touch Scribe HD','View','OT-983','OT-997D','OT-997',
    'OT-992D','OT-978','OT-988 Shockwave','OT-993','OT-903','OT-838',
    'OT-668','OT-605','OT-986','OT-991','OT-916','OT-720',
    'OT-902','OT-819 Soul','OT-870','OT-595','OT-358','OT-310',
    'OT-318D','OT-317D','OT-308','OT-282','OT-292','OT-228',
    'OT-985','OT-915','OT-810D','OT-906','OT-810','OT-995',
    'OT-990','OT-910','OT-908F','OT-908','OT-905','OT-900',
    'OT-891 Soul','OT-918','OT-918D','OT-890D','OT-890','OT-888',
    'OT-818','OT-813F','OT-813D','OT-807','OT-803','OT-799 Play',
    'OT-690','OT-665','OT-602','OT-585','OT-506','OT-385',
    'OT-361','OT-355','OT-330','OT-306','OT-223','OT-217',
    'OT-213','OT-209','OT-117','OT-113','OT-112','OT-109',
    'OT-105','OT-706','Net','OT-808','OT-606 One Touch CHAT','OT-255',
    'OT-252','OT-710','OT-108','OT-216','OT-206','OT-909 One Touch MAX',
    'Miss Sixty','OT-880 One Touch XTRA','OT-208','OT-301','OT-300','OT-980',
    'OT-806','OT-802 Wave','OT-305','OT-380','OT-505','OT-508A',
    'OT-565','OT-106','OT-800 One Touch CHROME','OT-800 One Touch Tribe','OT-708 One Touch MINI','OT-660',
    'OT-383','OT-203','OT-103','OT-600','Crystal','Miss Sixty 2009',
    'ELLE GlamPhone','OT-363','Roadsign','OT-303','OT-222','OT-280',
    'OT-202','OT-S121','OT-111','OT-102','Mandarina Duck Moon','Mandarina Duck',
    'OT-I650 SPORT','OT-I650 PRO','OT-V770','OT-V670','OT-V607A','OT-V570',
    'OT-V270','OT-V212','OT-S626A','OT-S521A','OT-S920','OT-S621',
    'OT-S520','OT-S320','OT-S319','OT-S218','OT-S215A','OT-S211',
    'OT-S210','OT-S120','OT-S107','ELLE No 3','OT-C825','OT-C717',
    'OT-C707','OT-C701','OT-C700A','OT-C507','OT-E227','OT-E225',
    'OT-E221','OT-E207','OT-E205','OT-E201','OT-E101','Lollipops',
    'OT-E220','OT-E805','OT-E230','OT-C635','OT-C630','OT-E801',
    'OT-E100','OT-C550','OT-E265','OT-E105','OT-E260','OT-C750',
    'OT-S853','OT-S850','OT-C560','OT-C555','OT-C552','OT-C551',
    'OT-C656','OT-C652','OT-C651','OT-E259','OT-E256','OT-E257',
    'OT-E160','OT-E252','OT-E159','OT-E158','OT-E157','OT 757',
    'OT 355','OT 156','OT 155','OT 153','OT 756','OT 557',
    'OT 565','OT 556','OT 835','OT 735i','OT 735','OT 535',
    'OT 531','OT 332','OT 331','OT 526','OT 320','OT 525',
    'OT 715','OT 512','OT 311','OT 511','OT 700','OT 500',
    'OT 300','OT View db @','OT Pocket','OT View db','OT Max db','OT Gum db',
    'OT Easy db','OT Club db','OT COM','OT Pro','OT Easy HF','OT Easy',
    'OT Club','OT Club +','OT Max','OT View','HC 1000','HC 800',
  ],

  // Apple — 146 modèles
  'apple-phones-48': [
    'iPhone 17e','iPad Air 13 (2026)','iPad Air 11 (2026)','iPad Pro 13 (2025)','iPad Pro 11 (2025)','iPhone 17 Pro Max',
    'iPhone 17 Pro','iPhone Air','iPhone 17','Watch Ultra 3','Watch Series 11','Watch Series 11 Aluminum',
    'Watch SE 3','iPad Air 13 (2025)','iPad Air 11 (2025)','iPad (2025)','iPhone 16e','iPad mini (2024)',
    'iPhone 16 Pro Max','iPhone 16 Pro','iPhone 16 Plus','iPhone 16','Watch Series 10','Watch Series 10 Aluminum',
    'iPad Pro 13 (2024)','iPad Pro 11 (2024)','iPad Air 13 (2024)','iPad Air 11 (2024)','iPhone 15 Pro Max','iPhone 15 Pro',
    'iPhone 15 Plus','iPhone 15','Watch Ultra 2','Watch Series 9','Watch Series 9 Aluminum','iPad Pro 12.9 (2022)',
    'iPad Pro 11 (2022)','iPad (2022)','iPhone 14 Pro Max','iPhone 14 Pro','iPhone 14 Plus','iPhone 14',
    'Watch Ultra','Watch Series 8','Watch Series 8 Aluminum','Watch SE 2','iPhone SE (2022)','iPad Air (2022)',
    'iPhone 13 Pro Max','iPhone 13 Pro','iPhone 13','iPhone 13 mini','iPad mini (2021)','iPad 10.2 (2021)',
    'Watch Edition Series 7','Watch Series 7','Watch Series 7 Aluminum','iPad Pro 12.9 (2021)','iPad Pro 11 (2021)','iPhone 12 Pro Max',
    'iPhone 12 Pro','iPhone 12','iPhone 12 mini','iPad Air (2020)','iPad 10.2 (2020)','Watch SE',
    'Watch Series 6 Aluminum','Watch Series 6','Watch Edition Series 6','iPhone SE (2020)','iPad Pro 12.9 (2020)','iPad Pro 11 (2020)',
    'iPhone 11 Pro Max','iPhone 11 Pro','iPhone 11','iPad 10.2 (2019)','Watch Edition Series 5','Watch Series 5',
    'Watch Series 5 Aluminum','iPad Air (2019)','iPad mini (2019)','iPad Pro 12.9 (2018)','iPad Pro 11 (2018)','iPhone XS Max',
    'iPhone XS','iPhone XR','Watch Series 4','Watch Series 4 Aluminum','iPad 9.7 (2018)','iPhone X',
    'iPhone 8 Plus','iPhone 8','Watch Edition Series 3','Watch Series 3','Watch Series 3 Aluminum','iPad Pro 12.9 (2017)',
    'iPad Pro 10.5 (2017)','iPad 9.7 (2017)','Watch Edition Series 2 42mm','Watch Edition Series 2 38mm','Watch Series 2 42mm','Watch Series 2 38mm',
    'Watch Series 2 Aluminum 42mm','Watch Series 1 Aluminum 42mm','Watch Series 2 Aluminum 38mm','Watch Series 1 Aluminum 38mm','iPhone 7 Plus','iPhone 7',
    'iPad Pro 9.7 (2016)','iPhone SE','iPhone 6s Plus','iPhone 6s','iPad Pro 12.9 (2015)','iPad mini 4 (2015)',
    'Watch Edition 42mm (1st gen)','Watch Edition 38mm (1st gen)','Watch 42mm (1st gen)','Watch 38mm (1st gen)','Watch Sport 42mm (1st gen)','Watch Sport 38mm (1st gen)',
    'iPad Air 2','iPad mini 3','iPhone 6 Plus','iPhone 6','iPad Air','iPad mini 2',
    'iPhone 5s','iPhone 5c','iPad mini Wi-Fi','iPad mini Wi-Fi + Cellular','iPad 4 Wi-Fi','iPad 4 Wi-Fi + Cellular',
    'iPhone 5','iPad 3 Wi-Fi + Cellular','iPad 3 Wi-Fi','iPhone 4s','iPad 2 Wi-Fi + 3G','iPad 2 Wi-Fi',
    'iPad 2 CDMA','iPhone 4','iPhone 4 CDMA','iPad Wi-Fi + 3G','iPad Wi-Fi','iPhone 3GS',
    'iPhone 3G','iPhone',
  ],

  // Asus — 207 modèles
  'asus-phones-46': [
    'Zenfone 12 Ultra','ROG Phone 9 Pro','ROG Phone 9 FE','ROG Phone 9','Zenfone 11 Ultra','ROG Phone 8 Pro',
    'ROG Phone 8','Zenfone 10','ROG Phone 7 Ultimate','ROG Phone 7','ROG Phone 6D Ultimate','ROG Phone 6D',
    'ROG Phone 6 Diablo Immortal Edition','ROG Phone 6 Batman Edition','Zenfone 9','ROG Phone 6 Pro','ROG Phone 6','ROG Phone 5s Pro',
    'ROG Phone 5s','Smartphone for Snapdragon Insiders','Zenfone 8 Flip','Zenfone 8','ROG Phone 5 Ultimate','ROG Phone 5 Pro',
    'ROG Phone 5','Zenfone 7 Pro','Zenfone 7','ROG Phone 3','ROG Phone 3 Strix','ROG Phone II ZS660KL',
    'Zenfone 6 ZS630KL','ZenFone Live (L2)','Zenfone Max Plus (M2) ZB634KL','Zenfone Max Shot ZB634KL','Zenfone Max Pro (M2) ZB631KL','Zenfone Max (M2) ZB633KL',
    'Zenfone Max (M1) ZB556KL','ZenFone Lite (L1) ZA551KL','ROG Phone ZS600KL','ZenFone Live (L1) ZA550KL','Zenfone Max Pro (M1) ZB601KL/ZB602K','Zenfone 5z ZS620KL',
    'Zenfone 5 ZE620KL','Zenfone 5 Lite ZC600KL','Zenfone Max (M1) ZB555KL','Zenfone Max Plus (M1) ZB570TL','Zenfone V V520KL','Zenfone 4 Pro ZS551KL',
    'Zenfone 4 ZE554KL','Zenfone 4 Selfie Lite ZB553KL','Zenfone 4 Selfie ZB553KL','Zenfone 4 Selfie Pro ZD552KL','Zenfone 4 Selfie ZD553KL','Zenfone 4 Max ZC520KL',
    'Zenfone 4 Max Pro ZC554KL','Zenfone 4 Max Plus ZC554KL','Zenfone 4 Max ZC554KL','Zenpad Z8s ZT582KL','Zenpad 3s 8.0 Z582KL','Zenfone Go ZB552KL',
    'Zenfone Live ZB501KL','Zenfone 3s Max ZC521TL','Zenpad 3S 10 Z500KL','Zenfone AR ZS571KL','Zenfone 3 Zoom ZE553KL','Zenfone Go ZB690KG',
    'Zenpad 3 8.0 Z581KL','Zenfone Go ZB500KL','Zenfone 3 Max ZC553KL','Zenfone 3 Deluxe 5.5 ZS550KL','Zenpad Z10 ZT500KL','Zenwatch 3 WI503Q',
    'Zenpad 3S 10 Z500M','Zenfone 3 Max ZC520TL','Zenfone 3 Laser ZC551KL','Zenfone 3 ZE520KL','Zenfone Pegasus 3','Zenpad Z8',
    'Zenfone 3 Ultra ZU680KL','Zenfone 3 Deluxe ZS570KL','Zenfone 3 ZE552KL','Zenfone Max ZC550KL (2016)','Zenfone Go ZB450KL','Zenfone Go ZB452KG',
    'Zenfone Go ZB551KL','Zenfone Go T500','Zenfone Go ZC451TG','Live G500TG','Zenwatch 2 WI501Q','Zenwatch 2 WI502Q',
    'Zenwatch WI500Q','Zenfone 2 Laser ZE551KL','Zenfone Zoom ZX551ML','Zenpad 8.0 Z380M','Zenpad 10 Z300M','Zenpad 10 Z300C',
    'Zenfone Go ZC500TG','Zenfone Max ZC550KL','Zenfone 2 Deluxe ZE551ML','Zenfone 2 Laser ZE601KL','Zenfone 2 Laser ZE600KL','Zenfone 2 Laser ZE550KL',
    'Zenfone 2 Laser ZE500KG','Zenfone 2 Laser ZE500KL','Zenpad 7.0 Z370CG','Zenfone 2E','Pegasus 2 Plus','Zenpad S 8.0 Z580CA',
    'Zenpad S 8.0 Z580C','Zenpad 8.0 Z380KL','Zenpad 8.0 Z380C','Zenpad C 7.0 Z170MG','Zenpad C 7.0','Zenfone Selfie ZD551KL',
    'Zenfone 2 ZE500CL','Zenfone 2 ZE550ML','Zenfone 2 ZE551ML','Fonepad 7 FE375CL','Zenfone C ZC451CG','Fonepad 7 FE171CG',
    'Zenfone Zoom ZX550','Pegasus','Zenfone 5 Lite A502CG (2014)','Memo Pad 10 ME103K','PadFone X mini','Memo Pad 7 ME572CL',
    'Memo Pad 7 ME572C','Zenfone 5 A500KL (2014)','Zenfone 4 A450CG (2014)','Memo Pad 8 ME581CL','Memo Pad 8 ME181C','Memo Pad 7 ME176C',
    'Fonepad 8 FE380CG','Fonepad 7 FE375CXG','Fonepad 7 FE375CG','Transformer Pad TF303CL','Transformer Pad TF103C','Fonepad 7 (2014)',
    'PadFone X','PadFone S','PadFone Infinity Lite','PadFone E','Zenfone 6 A601CG (2014)','Zenfone 6 A600CG (2014)',
    'Zenfone 5 A501CG (2015)','Zenfone 5 A500CG (2014)','Zenfone 4 (2014)','PadFone mini 4G (Intel)','PadFone mini (Intel)','PadFone mini',
    'Transformer Book Trio','PadFone Infinity 2','Memo Pad 10','Memo Pad 8 ME180A','Fonepad 7','Google Nexus 7 (2013)',
    'Fonepad Note FHD6','Transformer Pad TF701T','Memo Pad FHD10','Memo Pad HD7 8 GB','Memo Pad HD7 16 GB','Fonepad',
    'PadFone Infinity','Memo Pad Smart 10','Memo Pad ME172V','Google Nexus 7 Cellular','VivoTab RT TF600T','PadFone 2',
    'Google Nexus 7','Transformer Pad Infinity 700 LTE','Transformer Pad Infinity 700 3G','Transformer Pad TF300TG','Transformer Pad TF300T','Transformer Pad Infinity 700',
    'Memo','Transformer Prime TF700T','Transformer Prime TF201','PadFone','Transformer TF101','P835',
    'E600','P565','P552w','P320','M930','P550',
    'P750','P527','Z801','J502','V88i','M530w',
    'P526','J501','P735','Z810','P535','P525',
    'P505','M303','M307','M310','V80','V75',
    'V66','V55','Zenfone Pegasus 3s',
  ],

  // Blackberry — 92 modèles
  'blackberry-phones-36': [
    'KEY2 LE','Evolve X','Evolve','KEY2','Motion','Aurora',
    'Keyone','DTEK60','DTEK50','Priv','Leap','Classic Non Camera',
    'Porsche Design P\'9983','Passport','Classic','Z3','Porsche Design P\'9982','Z30',
    '9720','Q5','Z10','Q10','4G LTE Playbook','Curve 9320',
    'Curve 9220','Curve 9380','Bold 9790','Porsche Design P\'9981','Curve 9370','Curve 9360',
    'Curve 9350','Torch 9810','Torch 9860','Torch 9850','Bold Touch 9900','Bold Touch 9930',
    '4G Playbook HSPA+','Playbook Wimax','Playbook','Bold 9780','Style 9670','Curve 3G 9330',
    'Curve 3G 9300','Torch 9800','Pearl 3G 9105','Pearl 3G 9100','Bold 9650','Bold 9700',
    'Storm2 9520','Storm2 9550','Curve 8530','Curve 8520','Tour 9630','Curve 8980',
    'Curve 8900','Storm3','Storm 9500','Storm 9530','Pearl Flip 8230','Pearl Flip 8220',
    'Bold 9000','Volt','Pearl 8130','Pearl 8110','Pearl 8120','Curve 8330',
    'Curve 8320','Curve 8310','Curve 8300','8820','8830 World Edition','8800',
    'Pearl 8100','7130g','7130c','7130v','8707v','8700c',
    '7100x','7100t','7100v','7290','7730','7230',
    '6720','6230','Z20','A10','Porsche Design P\'9531','Playbook 2012',
    'Curve Touch','Curve Touch CDMA',
  ],

  // Cat — 22 modèles
  'cat-phones-89': [
    'S75','S53','S22 Flip','S62','S42 H+','B40',
    'S62 Pro','S42','S52','B35','S41','S31',
    'S61','S60','S30','S40','B30','B15 Q',
    'S50','B15','B100','B25',
  ],

  // Fairphone — 5 modèles
  'fairphone-phones-127': [
    '6','5','4','3+','3',
  ],

  // Google — 40 modèles
  'google-phones-107': [
    'Pixel 10a','Pixel 10 Pro Fold','Pixel 10 Pro XL','Pixel 10 Pro','Pixel 10','Pixel Watch 4',
    'Pixel 9a','Pixel 9 Pro XL','Pixel 9 Pro','Pixel 9','Pixel 9 Pro Fold','Pixel Watch 3',
    'Pixel 8a','Pixel 8 Pro','Pixel 8','Pixel Watch 2','Pixel Fold','Pixel Tablet',
    'Pixel 7a','Pixel 7 Pro','Pixel 7','Pixel Watch','Pixel 6a','Pixel 6 Pro',
    'Pixel 6','Pixel 5a 5G','Pixel 5','Pixel 4a 5G','Pixel 4a','Pixel 4 XL',
    'Pixel 4','Pixel 3a XL','Pixel 3a','Pixel 3 XL','Pixel 3','Pixel 2',
    'Pixel 2 XL','Pixel XL','Pixel','Pixel C',
  ],

  // Honor — 329 modèles
  'honor-phones-121': [
    'X80 Pro Max','600 Smart','Watch 6','X70 Pro Max','Play10','Win Turbo',
    '600 Pro (China)','600 (China)','600e','X7e','500 Smart','600 Pro',
    '600','Pad 20','MagicPad 3 Pro 12.3','Play11 Plus','X70 Refresh','X5d Plus',
    'X5d','X80i','Play 80 Pro','Play 80 Plus','Play 70C','Play 80',
    'Watch X5i','600 Lite','Magic V6','MagicPad4','Pad X8b','X6d',
    'Magic8 RSR Porsche Design','Pad 10 Pro','Magic8 Pro Air','Watch GS 5','Power2','Win',
    'Win RT','Play 60A','X8d','Magic8 Lite','Watch X5','500 Pro (China)',
    '500','Magic8 Pro','Magic8','Watch 5 Pro','MagicPad3 Pro 13.3','Play10A',
    'X5c','X5c Plus','X6b','X9d','X7d','400 Smart 4G',
    'Play10 4G','X7d 4G','Magic V Flip 2','X7c','Play10C','400 Smart',
    'Pad X7','X70','Pad GT2 Pro','MagicPad 3','Magic V5','X6c',
    '400 Pro (China)','400 (China)','400 Pro','400','Pad 10','X70i',
    'GT Pro','Pad GT','X60 GT','Power','400 Lite','Play 60',
    'Pad X9a','Play9A','Watch 5 Ultra','X8c','Magic7 Lite','Magic7 RSR Porsche Design',
    'GT','Pad V9','300 Ultra','300 Pro','300','X9c Smart',
    'Play9C (China)','Play9T','X9c','Magic7 Pro','Magic7','X5b Plus',
    'X5b','X7c 4G','X60 Pro','X60','Pad GT Pro','200 Smart',
    'Watch 5','Pad X8a','X60i','MagicPad 2 12.3','Pad 9 Pro','Magic Vs3',
    'Magic V3','Play 60 Plus','X7b 5G (50 MP)','Magic V Flip','X6b 4G','200 Pro',
    '200','200 Lite','90 Smart','X7b 5G','Magic6 RSR Porsche Design','Magic6 Ultimate',
    'Watch GS 4','Choice Watch','Magic V2 RSR Porsche Design','Magic6 Pro','Magic6','X50 GT',
    'X50 Pro','90 GT','Pad 9','X8b','Magic6 Lite','X7b',
    '100 Pro','100','X50i+','X5 Plus','X9b','Play 8T',
    'Magic Vs2','Watch 4 Pro','Play 50 Plus','V Purse','X40 GT Racing','X6a',
    'Magic V2','Watch 4','MagicPad 13','Pad X9','Pad X8 Pro','X50',
    'Play 40','X50i','90 Lite','90 Pro','90','Pad V8',
    'Play7T Pro','Play7T','70 Lite','Magic5 Ultimate','Magic5 Pro','Magic5',
    'Magic5 Lite','X8a','X5','X9a','X7a','80 Pro Flat',
    '80 GT','Pad V8 Pro','80 Pro','80','80 SE','Magic Vs Ultimate',
    'Magic Vs','Play 40 Plus','X40 GT','Play6C','X6','Pad X8',
    'Pad X8 Lite','X40','X8 5G','Pad 8','X40i','70 Pro+',
    '70 Pro','70','Play 30','Play6T Pro','Play6T','Magic4 Lite',
    'X7','X9','X9 5G','Magic4 Ultimate','X8','Magic4 Pro',
    'Magic4','60 SE','Watch GS 3','Magic V','X30','Play 30 Plus',
    '60 Pro','60','X30 Max','X30i','50 Lite','Play5 Youth',
    'Tablet V7','Tablet V7 Pro','X20','Magic3 Pro+','Magic3 Pro','Magic3',
    'Play 5T Pro','X20 SE','50 Pro','50','50 SE','Play5 5G',
    'Tablet X7','Play 20','Play 5T Youth','Tab 7','V40 Lite','View40',
    'V40 5G','10X Lite','30i','Watch GS Pro','Watch ES','Pad 6',
    'Pad X6','X10 Max 5G','30 Youth','8S 2020','Play4','Play4 Pro',
    'X10 5G','V6','9A','9C','9S','9X Lite',
    '30 Pro+','30 Pro','30','20e','Play 4T Pro','Play 4T',
    '8A 2020','8A Prime','30S','Play 9A','View30 Pro','View30',
    'V30 Pro','V30','MagicWatch 2','9X','20 lite (China)','Play 3e',
    'Play 3','20S','9X Pro','9X (China)','8S','Pad 5 10.1',
    'Pad 5 8','20 Pro','20','20 lite','20i','8A Pro',
    'Tab 5','View 20','Magic 2 3D','Magic 2','Play 8A','10 Lite',
    '8C','8X','8X Max','Note 10','9N (9i)','Play',
    '7S','10','7A','7C','9 Lite','View 10',
    '7X','6C Pro','9','6A (Pro)','8 Pro','Magic',
    'V8','Pad 2','6X','Holly 3','Note 8','8',
    '5A','5c','Holly 2 Plus','5X','7i','7',
    'Bee','4C','6 Plus','4X','Holly','4 Play',
    '3C Play','6','3X Pro','3C 4G','3X G750','3C',
    '3','2','U8860','GT 2 Pro','View',
  ],

  // Htc — 297 modèles
  'htc-phones-45': [
    'Wildfire E7 Plus','Wildfire E5 Life','Wildfire E6','Wildfire E6 Star','Wildfire E4 Plus','Wildfire E5',
    'Wildfire E5 Plus','U24 Pro','A101 Plus','A104','Wildfire E star','U23',
    'U23 Pro','A103 Plus','A103','A102','A101','Wildfire E2 Play',
    'Wildfire E3 lite','Wildfire E plus','Desire 22 Pro','Wildfire E2 Plus','Wildfire E3','Desire 21 Pro 5G',
    'Desire 20+','Wildfire E1 lite','Wildfire E2','Wildfire E1 plus','Wildfire E1','Wildfire E',
    'U20 5G','Desire 20 Pro','Desire 19s','Exodus 1s','Wildfire X','U19e',
    'Desire 19+','Desire 12s','Exodus 1','U12 life','U12+','Desire 12+',
    'Desire 12','U11 Eyes','U11+','U11 Life','U11','One X10',
    'U Ultra','U Play','10 evo','Desire 650','Desire 10 Pro','Desire 10 Compact',
    'One A9s','Desire 10 Lifestyle','Desire 728 Ultra','Desire 628','One M9 Prime Camera','Desire 830',
    'One S9','10 Lifestyle','10','Desire 825','Desire 630','Desire 530',
    'Desire 625','One X9','One M9s','Desire 828 dual sim','Desire 728 dual sim','One E9s dual sim',
    'Butterfly 3','One M9+ Supreme Camera','One A9','Desire 626 (USA)','Desire 626s','Desire 526',
    'Desire 520','One ME','Desire 820G+ dual sim','Desire 326G dual sim','One M9+','One M8s',
    'One E9+','One E9','One M9','Desire 820s dual sim','Desire 626G+','Desire 626',
    'Desire 526G+ dual sim','Desire 826 dual sim','Desire 320','Desire 620G dual sim','Desire 620','Nexus 9',
    'Desire 816G dual sim','One (M8 Eye)','Desire Eye','Desire 612','Desire 820q dual sim','Desire 820 dual sim',
    'Desire 820','One (E8) CDMA','Desire 510','One (M8) for Windows','One (M8) for Windows (CDMA)','Butterfly 2',
    'One Remix','One (M8) dual sim','Desire 516 dual sim','One (E8)','One mini 2','Desire 616 dual sim',
    'Desire 210 dual sim','One (M8) CDMA','One (M8)','Desire 310 dual sim','Desire 310','Desire 816 dual sim',
    'Desire 816','Desire 610','Desire 501 dual sim','Desire 700','Desire 700 dual sim','Desire 601 dual sim',
    'Desire 501','One Max','Desire 300','Desire 601','Desire 500','One mini',
    'Desire L','Desire P','Desire Q','8XT','Butterfly S','Desire 200',
    'Desire 600 dual sim','First','One Dual Sim','One','Desire U','Desire 400 dual sim',
    'Butterfly','DROID DNA','One SV CDMA','One SV','Desire SV','One VX',
    'One X+','Windows Phone 8X CDMA','Windows Phone 8X','Windows Phone 8S','One ST','One SC',
    'Desire X','Desire VT','Desire XC','Desire VC','Desire V','Desire C',
    'J','DROID Incredible 4G LTE','Evo 4G LTE','One XC','One X','One X AT&T',
    'One XL','One S C2','One S','One V','Velocity 4G Vodafone','Velocity 4G',
    'Titan II','Rezound','Vivid','EVO Design 4G','Sensation XL','Explorer',
    'Amaze 4G','Raider 4G','Rhyme','Hero S','Rhyme CDMA','Sensation XE',
    'Jetstream','Lead','Titan','Radar','Panache','Status',
    'Glacier','Trophy','DROID Incredible 2','Sensation 4G','EVO 3D','Sensation',
    'EVO 3D CDMA','HD7S','Prime','Merge','Incredible S','Desire S',
    'Wildfire S','Salsa','ChaCha','Flyer','Flyer Wi-Fi','EVO View 4G',
    'Inspire 4G','Freestyle','ThunderBolt 4G','EVO Shift 4G','Gratia','HD7',
    '7 Pro','7 Surround','7 Mozart','7 Trophy','Arrive','Desire HD',
    'Desire Z','Paradise','Evo 4G+','Aria','Wildfire CDMA','Wildfire',
    'HD mini','Desire','Legend','Rider','Google Nexus One','Smart',
    'HD2','Evo 4G','Droid Incredible','DROID ERIS','Pure','Tattoo',
    'Touch2','Hero CDMA','Hero','Ozone','Schubert','Snap',
    'Magic','Touch Pro2 CDMA','Tilt2','Touch Pro2','Touch Diamond2 CDMA','Touch Diamond2',
    'Dream','Touch Cruise 09','MAX 4G','Touch HD T8285','Touch HD','Touch 3G',
    'Touch Viva','S740','Touch Pro CDMA','Touch Pro','Touch Diamond CDMA','Touch Diamond',
    'Advantage X7510','P3470','Touch Cruise','Touch Dual','P6500','S730',
    'TyTN II','S630','Touch','P6300','Shift','Advantage X7500',
    'S710','P3350','P3400','P4350','P3600i','P3600',
    'P3300','S620','S310','TyTN','MTeoR','Wildfire R70',
    'One (M8i)','One M8 Prime','Tiara','Primo','Zeta','Ville',
    'Ignite','Desire HD2','A12',
  ],

  // Huawei — 532 modèles
  'huawei-phones-58': [
    'nova 16 Ultra','nova 16 Pro','nova 16','nova 16z','nova Y74','MatePad Pro Max',
    'nova 15 Max','Watch Ultimate Design Spring','Watch Buds 2','Pura X Max','Pura 90 Pro Max','Pura 90 Pro',
    'Pura 90','Watch Fit 5 Pro','Watch Fit 5','Enjoy 90 Pro Max','Enjoy 90m Plus','Enjoy 90 Plus',
    'Enjoy 90','Mate 80 Pro Max Wind','Watch GT Runner 2','nova 15 Ultra','nova 15 Pro','nova 15',
    'MatePad 11.5 (2026)','Mate X7','Mate 80 RS Ultimate','Mate 80 Pro Max','Mate 80 Pro','Mate 80',
    'MatePad Edge','Mate 70 Air','nova 14 Lite','nova Flip S','nova 14i','Watch Ultimate 2',
    'Watch GT 6 Pro','Watch GT 6','MatePad 12 X (2025)','Mate XTs Ultimate','MatePad Mini','MatePad Air (2025)',
    'MatePad 11.5 S (2025)','MatePad 11.5 (2025)','Pura 80 Ultra','Pura 80 Pro+','Pura 80 Pro','Pura 80',
    'Nova Y73','nova 14 Ultra','nova 14 Pro','nova 14','Watch 5','Watch Fit 4 Pro',
    'Watch Fit 4','MatePad Pro 12.2 (2025)','Nova Y72S','Nova Y63','Enjoy 80','Pura X',
    'Mate XT Ultimate','nova 13i','Enjoy 70X Energy','Enjoy 70X','Mate 70 RS Ultimate','Mate 70 Pro+',
    'Mate 70 Pro','Mate 70','Mate X6','MatePad Pro 13.2 (2025)','nova 13 Pro','nova 13',
    'Watch GT 5 Pro','Watch GT 5','Watch D2','MatePad 12 X','MatePad Air (2024)','MatePad Pro 12.2 (2024)',
    'nova Flip','MatePad SE 11','MatePad 11.5 S','Pura 70 Ultra','Pura 70 Pro+','Pura 70 Pro',
    'Pura 70','nova 12i','nova 12 SE','nova 12s','Pocket 2','Enjoy 70z',
    'nova Y72','nova 12 Ultra','nova 12 Pro','nova 12','nova 12 Lite','Enjoy 70',
    'MatePad Pro 11 (2024)','nova 11 SE','Watch Ultimate Design','MatePad Pro 13.2','Mate 60 RS Ultimate','Watch GT 4',
    'Mate 60 Pro+','Mate X5','Mate 60 Pro','Mate 60','MatePad 11.5','MatePad Air',
    'nova Y91','Watch 4 Pro','Watch 4','nova 11i','nova Y71','Enjoy 60X',
    'nova 11 Ultra','nova 11 Pro','nova 11','Mate X3','P60 Pro','P60',
    'P60 Art','Enjoy 60 Pro','Enjoy 60','Watch Ultimate','MatePad 11 (2023)','nova 10 Youth',
    'Watch Buds','Enjoy 50z','Watch GT 3 SE','Pocket S','Watch GT Cyber','nova Y61',
    'MatePad C5e','nova 10 SE','Mate 50 RS Porsche Design','Mate 50 Pro','Mate 50E','Mate 50',
    'nova 10z','MatePad Pro 11 (2022)','nova 10 Pro','nova 10','nova Y90','MatePad 10.4 (2022)',
    'Mate Xs 2','Watch GT 3 Porsche Design','Watch GT 3 Pro','Watch D','MatePad SE','nova 9 SE 5G',
    'nova Y70 Plus','P50E','nova 9 SE','P50 Pocket','nova 8 SE 4G','nova Y60',
    'Enjoy 20e','Watch GT Runner','Watch Fit mini','Watch GT 3','nova 9 Pro','nova 9',
    'nova 8','P50 Pro','P50','nova 8 SE Youth','nova 8i','Mate 40 Pro 4G',
    'Mate 40E 4G','Mate X2 4G','MatePad Pro 12.6 (2021)','MatePad Pro 10.8 (2021)','MatePad 11 (2021)','Watch 3 Pro',
    'Watch 3','nova 8 Pro 4G','MatePad T 10','Watch Fit Elegant','Mate 40E','P40 4G',
    'Mate X2','nova 8 Pro 5G','nova 8 5G','Enjoy 20 SE','nova 8 SE','Mate 40 RS Porsche Design',
    'Mate 40 Pro+','Mate 40 Pro','Mate 40','Watch GT 2 Porsche Design','Mate 30E Pro 5G','nova 7 SE 5G Youth',
    'Y7a','P smart 2021','MatePad 5G','Watch GT 2 Pro','Y9a','Enjoy 20 Plus 5G',
    'Enjoy 20 5G','Watch Fit','MatePad 10.8','MatePad T 10s','Enjoy Tablet 2','Children\'s Watch 4X',
    'Enjoy 20 Pro','Enjoy Z 5G','P Smart S','Y8p','P40 lite 5G','P30 Pro New Edition',
    'MatePad T8','Y8s','Y6p','Y5p','P smart 2020','nova 7 Pro 5G',
    'nova 7 5G','nova 7 SE','MatePad 10.4','Watch GT 2e','Enjoy 10e','P40 Pro+',
    'P40 Pro','P40','P40 lite E','P40 lite','MatePad Pro 10.8 5G (2019)','Mate Xs',
    'P30 lite New Edition','Y7p','nova 7i','Y6s (2019)','P smart Pro 2019','nova 6 5G',
    'nova 6','nova 6 SE','MatePad Pro 10.8 (2019)','Mate X','Y9s','nova 5z',
    'Enjoy 10s','Enjoy 10','Mate 30 RS Porsche Design','Mate 30 Pro 5G','Mate 30 Pro','Mate 30 5G',
    'Mate 30','Watch GT 2','nova 5i Pro','Enjoy 10 Plus','nova 5T','MediaPad M6 10.8',
    'MediaPad M6 Turbo 8.4','MediaPad M6 8.4','nova 5 Pro','nova 5','nova 5i','Y9 Prime (2019)',
    'P20 lite (2019)','P Smart Z','Mate 20 X (5G)','P30 Pro','P30','P30 lite',
    'nova 4e','Y5 (2019)','Enjoy 9e','Enjoy 9s','Y Max','MediaPad M5 Lite 8',
    'Y6 Pro (2019)','Y6 (2019)','Y7 (2019)','Y7 Prime (2019)','Y7 Pro (2019)','Y5 lite (2018)',
    'nova 4','P smart 2019','Enjoy 9','Watch Magic','Watch GT','Mate 20 RS Porsche Design',
    'Mate 20 X','Mate 20 Pro','Mate 20','MediaPad T5','MediaPad M5 lite','Y9 (2019)',
    'Mate 20 lite','P Smart+ 2019','nova 3i','nova 3','Watch 2 2018','Y5 Prime (2018)',
    'Y3 (2018)','Y6 Prime (2018)','Y6 (2018)','Mate RS Porsche Design','P20 Pro','P20',
    'P20 lite','Y7 Pro (2018)','Y7 Prime (2018)','Y7 (2018)','Y9 (2018)','MediaPad M5 10 (Pro)',
    'MediaPad M5 10','MediaPad M5 8','P smart','nova 2s','Mate 10 Porsche Design','Mate 10 Pro',
    'Mate 10','Watch 2 Pro','Mate 10 Lite','P9 lite mini','Y7 Prime','MediaPad M3 Lite 8',
    'MediaPad T3 10','MediaPad M3 Lite 10','nova 2 plus','nova 2','Y6II Compact','MediaPad T3 8.0',
    'MediaPad T3 7.0','Y7','Y6 (2017)','Y5 (2017)','Y3 (2017)','Watch 2 Classic',
    'Watch 2','P10 Plus','P10','P10 Lite','P8 Lite (2017)','Enjoy 6s',
    'Mate 9 Pro','Mate 9 Porsche Design','Mate 9','Fit','Enjoy 6','MediaPad M3 8.4',
    'nova plus','nova','MediaPad T2 10.0 Pro','MediaPad T2 7.0 Pro','MediaPad T2 7.0','G9 Plus',
    'MediaPad T1 7.0 Plus','MediaPad M2 7.0','Y3II','Y5II','P9 lite','P9 Plus',
    'P9','MediaPad M2 10.0','Watch','Enjoy 5s','Mate 8','G7 Plus',
    'Y6 Pro','Nexus 6P','Mate S','Y6','G8','MediaPad M2 8.0',
    'Y560','Y625','P8lite ALE-L04','P8lite','P8max','P8',
    'SnapTo','MediaPad X2','Y635','Y360','Ascend Y540','Ascend G628',
    'Ascend Y520','Ascend Y221','Ascend GX1','Ascend Mate7 Monarch','MediaPad T1 10','MediaPad T1 8.0',
    'MediaPad T1 7.0','Ascend G620s','Ascend Y550','Ascend G7','Ascend P7 Sapphire Edition','Ascend Mate7',
    'Ascend G535','Y300II','Ascend G630','Ascend Y330','Ascend Plus','Ascend P7',
    'Ascend P7 mini','Ascend G730','Ascend Y600','MediaPad 10 Link+','Ascend G6 4G','Ascend G6',
    'MediaPad M1','MediaPad X1','Ascend Y530','MediaPad 7 Youth2','Ascend P6 S','Ascend Mate2 4G',
    'Ascend Y320','Ascend Y220','Ascend G740','Ascend Y511','Ascend W2','G6153',
    'G3621L','Ascend G700','G610s','U8687 Cronos','Ascend G525','MediaPad 7 Youth',
    'MediaPad 7 Vogue','Ascend P6','Ascend Y300','Premia 4G M931','Ascend Y210D','Ascend P2',
    'Ascend G615','Ascend G526','Ascend G350','Ascend G312','Ascend W1','Ascend Mate',
    'Ascend D2','Ascend G510','Ascend G500','Ascend Y201 Pro','MediaPad 10 Link','Ascend Y',
    'Summit','Ascend P1 LTE','Fusion 2 U8665','Ascend G600','Ascend G330','MediaPad 7 Lite',
    'Ascend Y100','Ascend Y200','Ascend G330D U8825D','Ascend G300','Ascend P1 XL U9200E','Ascend P1',
    'Ascend Q M5660','G6005','G6800','G6310','G5000','Activa 4G',
    'G5520','G6609','Fusion U8652','MediaPad 10 FHD','Ascend D1 XL U9500E','Ascend D1',
    'Ascend D quad XL','Ascend D quad','Ascend P1s','M886 Mercury','G7300','G7005',
    'MediaPad','MediaPad S7-301w','D51 Discovery','U8520 Duplex','T8300','U8350 Boulder',
    'Impulse 4G','Pillar','U8850 Vision','Ascend II','U8800 Pro','G7206',
    'U5510','G5500','G6620','U8650 Sonic','U8180 IDEOS X1','G6608',
    'G7010','U5900s','IDEOS S7 Slim','IDEOS S7 Slim CDMA','U9000 IDEOS X6','U8800 IDEOS X5',
    'U8510 IDEOS X3','U8150 IDEOS','U8500 IDEOS X2','U7520','G6150','G7002',
    'U8300','IDEOS S7','C3200','U3100','U8110','U8100',
    'U8230','U8220','U7510','U1270','U9130 Compass','U1250',
    'G6600 Passport','U9150','U7310','U121','U120','U3300',
    'U1310','U1100','U1000','T156','T158','T208',
    'T261L','T211','T161L','T330','T201','T552',
    'Mate 30 Lite','G10','Mulan','Ascend W3',
  ],

  // Lenovo — 265 modèles
  'lenovo-phones-73': [
    'Legion Y900 13','Legion Y900 11','Tab Plus Gen 2','Legion Y70 (2026)','Idea Tab Pro Gen 2','ThinkTab X11 Gen 1',
    'Legion Y700 (Gen 5)','Idea Tab Plus','Idea Tab','Yoga Tab','Tab','Tab One',
    'Legion Y700 (Gen 4)','Idea Tab Pro','Yoga Tab Plus','Legion Y700 (2025)','Legion Tab','Tab K11 Plus',
    'Tab Plus','Tab M11','Legion Y700 (2023)','Tab P12','Tab M10','Tab Extreme',
    'Tab M9','Tab M8 (4th Gen)','Tab P11 Gen 2','Tab P11 Pro Gen 2','Tab M10 Gen 3','Pad Pro 2022',
    'Legion Y70','Tab M10 Plus (3rd Gen)','Legion Y700','Legion Y90','K14 Plus','Tab K10',
    'Tab P12 Pro','Tab P11 5G','K13 Pro','K13','Yoga Tab 11','Tab P11 Plus',
    'Tab M8 (3rd Gen)','Tab M7 (3rd Gen)','K13 Note','Yoga Tab 13','Pad Pro','Pad Plus',
    'Pad','Legion 2 Pro','Legion Duel 2','K12 Pro','K12 (China)','A8 2020',
    'Tab P11 Pro','Tab P11','Tab M10 HD Gen 2','Legion Duel','Legion Pro','A7',
    'M10 Plus','M10 FHD REL','Yoga Smart Tab','K10 Plus','K10 Note','A6 Note',
    'Tab M8 (FHD)','Tab M8 (HD)','Tab M7','Z6','Z6 Pro 5G','Z6 Youth',
    'Z6 Pro','K6 Enjoy','Tab V7','S5 Pro GT','Z5s','Z5 Pro GT',
    'Z5 Pro','S5 Pro','K5 Pro','K9','Z5','K5 Note (2018)',
    'A5','K5 play','K5','S5','K320t','moto tab',
    'Tab 7 Essential','Tab 7','K8 Plus','K8','K8 Note','Tab 4 10 Plus',
    'Tab 4 10','Tab 4 8 Plus','Tab 4 8','Tab3 8 Plus','ZUK Edge','A6600 Plus',
    'A6600','B','A Plus','P2','K6 Note','K6 Power',
    'K6','Yoga Tab 3 10','Yoga Tab 3 Plus','Vibe A','C2 Power','C2',
    'Phab2 Plus','Phab2','Phab2 Pro','ZUK Z2','Vibe C','ZUK Z2 Pro',
    'Tab3 10','Tab3 8','Tab3 7','Vibe K5 Plus','Vibe K5','A7000 Turbo',
    'Vibe P1 Turbo','K5 Note','Lemon 3','Vibe S1 Lite','Vibe K4 Note','Vibe X3 c78',
    'Vibe X3','A3690','Yoga Tab 3 Pro','Yoga Tab 3 8.0','A1000','Phab',
    'Phab Plus','Vibe P1','A6010 Plus','A6010','Vibe P1m','Vibe S1',
    'ZUK Z1','A2010','A616','A3900','K80','S60',
    'A6000 Plus','A1900','K3 Note','Vibe Shot','A7000 Plus','A7000',
    'A5000','Tab 2 A10-70','Tab 2 A8-50','P70','Tab 2 A7-30','Tab 2 A7-20',
    'Tab 2 A7-10','A6000','P90','Vibe X2 Pro','K3','Golden Warrior Note 8',
    'A916','A319','S856','S580','S90 Sisley','A606',
    'Yoga Tablet 2 Pro','Yoga Tablet 2 10.1','Yoga Tablet 2 8.0','Tab S8','Vibe X2','Vibe Z2',
    'A850+','Vibe Z2 Pro','Golden Warrior A8','Golden Warrior S8','S939','S750',
    'A889','A680','A316i','A328','A536','A526',
    'A10-70 A7600','A8-50 A5500','A7-50 A3500','A7-30 A3300','Yoga Tablet 10 HD+','S860',
    'S850','S660','A880','A859','S930','S650',
    'Vibe Z K910','Yoga Tablet 10','Yoga Tablet 8','A630','A516','Vibe X S960',
    'S5000','A850','A706','P780','S820','A390',
    'A369i','A269i','S920','IdeaTab S6000H','IdeaTab S6000F','IdeaTab S6000L',
    'IdeaTab S6000','IdeaTab A3000','IdeaTab A1000','K900','S890','IdeaTab A2107',
    'A830','A820','A800','A789','A690','S720',
    'P770','A60+','S560','S880','A660','K860',
    'P700i','A65','A335','A185','S800','Q350',
    'Q330','A336','E156','LePhone S2','A60','K800',
    'IdeaPad S2','LePad S2010','LePad S2007','LePad S2005','IdeaPad A1','IdeaPad K1',
    'ThinkPad','K12','K7','ZUK Z1 mini','A5860','ideapad',
    'Vibe Z3 Pro',
  ],

  // Lg — 667 modèles
  'lg-phones-20': [
    'Ultra Tab','W41 Pro','W41+','W41','W31+','W31',
    'W11','K92 5G','K62','Q52','K52','K42',
    'K71','Wing 5G','K22','Q92 5G','Q31','K31',
    'Velvet 5G UW','Q61','Stylo 6','Velvet','Velvet 5G','Folder 2',
    'V60 ThinQ 5G UW','V60 ThinQ 5G','Q51','W10 Alpha','K61','K51S',
    'K41S','G Pad 5 10.1','V50S ThinQ 5G','G8X ThinQ','Q70','K30 (2019)',
    'K20 (2019)','K40S','K50S','W30 Pro','W30','W10',
    'Stylo 5','V50 ThinQ 5G','G8S ThinQ','G8 ThinQ','Q60','K50',
    'K40','Q9','V40 ThinQ','Watch W7','Tribute Empire','Candy',
    'G7 Fit','G7 One','Q8 (2018)','K11 Plus','Q Stylo 4','Q Stylus',
    'V35 ThinQ','Q7','G7 ThinQ','V30S ThinQ','Zone 4','X power 3',
    'K30','K10 (2018)','K8 (2018)','Aristo 2','X4+','V30',
    'Q8 (2017)','Q6','G Pad IV 8.0 FHD','X venture','G6','X power2',
    'Watch Sport','Watch Style','Stylo 3 Plus','Stylus 3','Harmony','K20 plus',
    'K10 (2017)','K8 (2017)','K7 (2017)','K4 (2017)','K3 (2017)','G Pad III 10.1 FHD',
    'U','V20','X Skin','X5','X max','X mach',
    'G Pad III 8.0 FHD','G Pad X 8.0','X power','X style','Stylus 2 Plus','Stylo 2',
    'K5','K3','G5 SE','G5','X cam','X screen',
    'K8','Stylus 2','K10','K7','K4','G Pad II 8.3 LTE',
    'Ray','G Vista 2','G Watch R W110','Watch Urbane W150','Watch Urbane 2nd Edition LTE','V10',
    'Nexus 5X','Zero','G Pad II 10.1','G Pad II 8.0 LTE','Wine Smart','Tribute 2',
    'Bello II','G4 Beat','G360','G350','G4c','G4 Dual',
    'G4','G Stylo','G4 Stylus','AKA','Watch Urbane LTE','G Watch W100',
    'Magna','Spirit','Leon','Joy','G Flex2','Tribute',
    'L Prime','G2 Lite','G3 Dual-LTE','G3 Screen','F60','L60',
    'L60 Dual','G3 Stylus','L Bello','L Fino','G Pad 8.0 LTE','G Vista',
    'G3 A','G Pad 7.0 LTE','L50','L30','L20','G Vista (CDMA)',
    'G3 LTE-A','G3 S Dual','G3 S','L65 D280','G3 (CDMA)','G3',
    '450','L35','Volt','G Pad 10.1 LTE','G Pad 10.1','G Pad 8.0',
    'G Pad 7.0','L80','L80 Dual','Lucid 3 VS876','L65 Dual D285','G Pad 8.3 LTE',
    'F70 D315','G2 mini LTE (Tegra)','G2 mini LTE','G2 mini','L90 Dual D410','L90 D405',
    'L70 D320N','L70 Dual D325','L45 Dual X132','L40 D160','L40 Dual D170','G Pro 2',
    'Optimus L4 II Tri E470','Optimus L1 II Tri E475','Optimus F3Q','GX F310L','Nexus 5','G Flex',
    'Fireweb','G Pro Lite','G Pro Lite Dual','Optimus L2 II E435','Vu 3 F300L','G Pad 8.3',
    'G2','Optimus L9 II','Enact VS890','Optimus GJ E975W','Optimus L4 II Dual E445','Optimus L4 II E440',
    'Optimus Zone VS410','Optimus F3','Lucid2 VS870','Optimus F7','Optimus F6','Optimus F5',
    'Optimus G Pro E985','Optimus L7 II Dual P715','Optimus L7 II P710','Optimus L5 II Dual E455','Optimus L5 II E460','Optimus L3 II Dual E435',
    'Optimus L3 II E430','Optimus L1 II E410','Nexus 4 E960','A390','A395','C299',
    'Tri Chip C333','Spectrum II 4G VS930','Mach LS860','Optimus L9 P769','Optimus Vu II','Optimus Vu II F200',
    'Optimus G E970','Optimus G LS970','Optimus G E975','Intuition VS950','Splendor US730','Escape P870',
    'Optimus L5 Dual E615','Optimus L9 P760','Motion 4G MS770','Optimus Vu P895','Optimus L3 E405','C199',
    'T385','T375 Cookie Smart','Optimus Elite LS696','T370 Cookie Smart','Optimus LTE2','Optimus True HD LTE P936',
    'Xpression C395','Lucid 4G VS840','Optimus M+ MS695','Optimus 4X HD P880','Optimus 3D Max P720','Optimus 3D Cube SU870',
    'Optimus L7 P700','Optimus L5 E610','Optimus Vu F100S','Optimus LTE Tag','Optimus L3 E400','Optimus Pad LTE',
    'Rumor Reflex  LN272','Connect 4G MS840','Viper 4G LTE LS840','Spectrum VS920','X350','Prada 3.0',
    'Nitro HD','Optimus 4G LTE P935','Optimus 2 AS680','Extravert VN271','DoublePlay','Enlighten VS700',
    'S367','Jil Sander Mobile','Optimus Slider','Optimus LTE SU640','Optimus LTE LU6200','Optimus EX SU880',
    'Optimus Q2 LU6500','Optimus Hub E510','Optimus Sol E730','Optimus Net Dual','Optimus Net','Esteem MS910',
    'Marquee LS855','Optimus Black (White version)','Optimus Pro C660','S365','A350','A258',
    'A250','A270','A290','A230','A190','A200',
    'T515 Cookie Duo','T510','T505','EGO T500','EGO Wi-Fi','C375 Cookie Tweet',
    'C365','C360','A100','Optimus Big LU6800','Cosmos 2','US760 Genesis',
    'Phoenix P505','Thrive P506','Thrill 4G P925','T315','Optimus 3D P920','Optimus Pad V900',
    'A180','A165','A160','Optimus Chat C550','A140','Optimus Me P350',
    'Optimus Black P970','Optimus 2X SU660','Optimus 2X','Optimus Mach LU3000','Revolution','X335',
    'C310','Cookie WiFi T310i','GU200','A120','A155','S310',
    'P525','P520','Axis','Apex','Cosmos Touch VN270','Vortex VS660',
    'C320 InTouch Lady','GT550 Encore','GS390 Prime','Quantum','C900 Optimus 7Q','E900 Optimus 7',
    'Town C300','Optimus Chic E720','Optimus M','Octane','Optimus S','Optimus T',
    'Optimus One P500','GW910','A130','GW370 Rumour Plus','GD550 Pure','KS365',
    'GM650s','Scarlet II TV','Flick T320','Cookie 3G T320','Wink 3G T320','C710 Aloha',
    'Cookie Style T310','Wink Style T310','Cookie Lite T300','C105','GX300','GU292',
    'GM360 Viewty Snap','Fathom VS750','Vu Plus','GT400 Viewty Smile','SU420 Cafe','Optimus Z',
    'SU920','KM570 Cookie Gig','Optimus Q LU2300','GX500','KH3900 Joypop','GT950 Arena',
    'GB280','GS155','GS107','GS106','KP108','GD350',
    'KH5200 Andro-1','GT540 Optimus','GT405','GS290 Cookie Fresh','GW990','GS500 Cookie Plus',
    'GX200','KF305','GW880','GD880 Mini','Etna C330','Wink Plus GT350i',
    'Town GT350','KU2100','GD580 Lollipop','GS200','GS190','GW820 eXpo',
    'GU230 Dimsun','GD710 Shine II','GB160','GU285','8575 Samba','KM555E',
    'GD310','GD510 Pop','BL20 New Chocolate','CF360','GW620','GM750',
    'BL40 New Chocolate','GW300','GB270','GB190','GB109','GB170',
    'GW550','KB775 Scarlet','GT500 Puccini','GT505','GW520','GD900 Crystal',
    'GC900 Viewty Smart','GB230 Julia','GD330','KS660','GB125','Xenon GR500',
    'GB210','GM200 Brio','KC560','KM900 Arena','GM730 Eigen','KC910i Renoir',
    'GB250','GB220','GB102','KT770','GB130','GM310',
    'GM210','KM330','GB110','GB106','GD910','CT810 Incite',
    'KP152','KS500','KF900 Prada','KC780','KP500 Cookie','KP501 Cookie',
    'KP502 Cookie','KB770','KC910 Renoir','KP270','CB630 Invision','KF311',
    'CP150','KP265','KP260','KP199','KP170','GT365 Neon',
    'Univa E510','KS360','KF390','KF350','KF245','KF240',
    'U370','HB620T','KC550','KF757 Secret','KF750 Secret','KF755 Secret',
    'CU915 Vu','KF700','KF600','KF510','KP320','KT610',
    'KT520','KM710','MG295','KF310','KF300','KM500',
    'KM386','KM380','KM338','KG375','KP235','KP220',
    'KP215','KP210','KP130','KP110','KP105','KP100',
    'KU385','KU380','U960','KG290','KG288','KS20',
    'KU990 Viewty','KE990 Viewty','KE590','KE500','KG280','KG275',
    'MG160','KU580','KE850 Prada','KE970 Shine','KU970 Shine','KE770 Shine',
    'CU720 Shine','KU950','KS10','KU311','Trax CU575','CU500V',
    'CU515','CE110','KU250','KE260','KE800','KE820',
    'KU800','L343i','U830','KP200','L600v','KP202',
    'CU500','U400','U310','U300','KG800','KG810',
    'KE600','KG330','KG320','CG180','KG300','KG270',
    'KG200','KG195','KG920','KU730','U900','V9000',
    'KG245','KG240','KG225','KG220','KG210','KG190',
    'KG130','KG120','KG110','C2600','U890','U8550',
    'M6100','C2500','C1150','S5300','S5200','S5100',
    'S5000','U880','P7200','B2250','B2070','B2050',
    'M4410','M4330','M4300','F3000','F2410','F2250',
    'L342i','L341i','C3400','C3380','C3320','C3310',
    'C3300','U8380','U8360','U8330','U8290','U8210',
    'U8200','U8180','B2150','B2100','B2000','F2400',
    'F1200','F7250','A7150','L5100','C2200','C2100',
    'G1800','G1610','G1700','F2300','F2100','L3100',
    'C3100','G3100','L1100','C1400','C1200','C1100',
    'G1600','T5100','G7200','G7120','U8150','U8138',
    'U8120','U8110','U8100','G7100','G7070','G7050',
    'G7030','G1500','G5500','G5400','G5310','G5300',
    'G8000','G7020','W7020','G7000','W7000','G5200',
    'W5200','G3000','W3000','B1200','LG 510w','LG-600',
    'LG-500','LG-200','G4 Pro','Optimus LTE','X3','E2',
    'Fantasy E740',
  ],

  // Meizu — 87 modèles
  'meizu-phones-74': [
    '22','Note 22 Pro','Note 22','Mblu 22 Pro','Mblu 22','Note 22 4G',
    'Note 16','Note 16 Pro','mblu 21','Lucky 08','Note 21 Pro','Note 21',
    'Blue 20','21 Note','21 Pro','21','20 Classic','20 Infinity',
    '20 Pro','20','18s Pro','18s','18x','Watch',
    '18 Pro','18','17 Pro','17','16T','M10',
    '16s Pro','16Xs','16s','Note 9','Zero','C9 Pro',
    'C9','Note 8','X8','V8 Pro','V8','16X',
    '16','16 Plus','M6T','M8c','15 Plus','15',
    '15 Lite','E3','M6s','M6','M6 Note','Pro 7 Plus',
    'Pro 7','M5c','E2','M5s','M5 Note','M3x',
    'Pro 6 Plus','MX5e','U10','U20','Pro 6s','M5',
    'M3 Max','M3e','MX6','M3s','M3','Pro 6',
    'M3 Note','M1 Metal','PRO 5','M2','MX5','M2 Note',
    'M1','M1 Note','MX4 Pro','MX4','MX3','MX2',
    'MX 4-core','MX','PRO 5 mini',
  ],

  // Microsoft — 32 modèles
  'microsoft-phones-64': [
    'Surface Duo 2','Surface Duo','Lumia 650','Lumia 950 XL Dual SIM','Lumia 950 XL','Lumia 950 Dual SIM',
    'Lumia 950','Lumia 550','Lumia 540 Dual SIM','Lumia 430 Dual SIM','Lumia 640 XL LTE Dual SIM','Lumia 640 XL LTE',
    'Lumia 640 XL Dual SIM','Lumia 640 XL','Lumia 640 LTE Dual SIM','Lumia 640 LTE','Lumia 640 Dual SIM','Lumia 532 Dual SIM',
    'Lumia 532','Lumia 435 Dual SIM','Lumia 435','Lumia 535 Dual SIM','Lumia 535','Surface 2',
    'Surface','Kin TWOm','Kin ONEm','Kin Two','Kin One','Lumia 850',
    'Lumia 1030','Lumia 1330',
  ],

  // Motorola — 701 modèles
  'motorola-phones-4': [
    'Moto G77 Power','Moto Pad 70 Pro','Moto G Max','Edge (2026)','Edge 70 Pro+','Moto G87',
    'Moto G47','Moto G37 Power','Moto G37','Razr Ultra 2026','Razr 70 Ultra','Razr+ 2026',
    'Razr 70+','Razr 2026','Razr 70','Edge 70 Pro','Moto Pad (2026)','Moto G Stylus (2026)',
    'Edge 70 Fusion+','Edge 70 Fusion','Moto G77','Moto G67','Moto G17 Power','Moto G17',
    'Razr Fold','Signature','Moto Watch','Moto Watch 120','Moto G Power (2026)','Moto G57 Power',
    'Moto G57','Moto G (2026)','Moto G Play (2026)','Moto G67 Power','Edge 70','Moto G100S',
    'Moto G100','Moto Pad 60 Neo','Edge 60 Neo','Moto G06 Power','Moto G06','G96',
    'Moto G86 Power','Moto G86','Moto G56','Edge (2025)','Edge 60 Pro','Edge 60',
    'Razr 60 Ultra','Razr Ultra 2025','Razr 60','Razr 2025','Razr+ 2025','Moto Watch Fit',
    'Moto Pad 60 Pro','Edge 60 Stylus','Moto G Stylus 5G (2025)','Edge 60s','Edge 60 Fusion','Moto G Power (2025)',
    'Moto G (2025)','Moto G15','Moto G15 Power','Moto G05','Moto E15','ThinkPhone 25',
    'Moto G75','Moto S50','Edge 50 Neo','Moto G55','Moto G35','Moto G45',
    'Edge 50','Razr+ 2024','Razr 50 Ultra','Razr 2024','Razr 50','Moto G85',
    'S50 Neo','Moto E14','Edge (2024)','Moto X50 Ultra','Moto G Stylus 5G (2024)','Edge 50 Ultra',
    'Edge 50 Fusion','Edge 50 Pro','Moto G64','Moto G04s','Moto G Power (2024)','Moto G (2024)',
    'Moto Watch 40','Moto G24 Power','Moto G24','Moto G04','Moto G Play (2024)','Moto G34',
    'Edge (2023)','Edge 40 Neo','Moto G54','Moto G54 Power','Moto G84','Moto G14',
    'Razr 40 Ultra','Razr 40','Moto G Stylus 5G (2023)','Edge 40','Edge+ (2023)','Moto G Stylus (2023)',
    'Moto G (2023)','Moto Watch 200','Moto Watch 70','Moto G Power 5G','Edge 40 Pro','Defy 2',
    'Moto G73','Moto G53','Moto G23','Moto G13','Moto E13','ThinkPhone',
    'Moto X40','Moto G Play (2023)','Moto E32 (India)','Moto G72','Moto E22i','Moto E22',
    'Edge 30 Ultra','Edge 30 Fusion','Edge 30 Neo','Moto E22s','Edge (2022)','Moto Tab G62',
    'Moto X30 Pro','Moto S30 Pro','Razr 2022','Moto G62 (India)','Moto G32','Moto G62 5G',
    'Moto G42','Moto E32s','Moto G71s','Moto G82','Moto E32','Edge 30',
    'Moto G Stylus 5G (2022)','Moto G (2022)','Moto G52','Moto G22','Edge+ 5G UW (2022)','Edge 30 Pro',
    'Moto G Stylus (2022)','Moto Tab G70','Edge X30','Edge S30','Moto G200 5G','Moto G71 5G',
    'Moto G51 5G','Moto G41','Moto G31','Moto G Power (2022)','Moto Watch 100','Moto E30',
    'Edge 5G UW (2021)','G Pure','Moto E40','Tab G20','Moto G60','Moto E20',
    'Moto G50 5G','Edge (2021)','Edge 20 Fusion','Moto G60S','Edge 20 Pro','Edge 20',
    'Edge 20 Lite','one 5G UW ace','Defy (2021)','Moto G Stylus 5G','Moto G20','Moto G40 Fusion',
    'Moto G100 (2021)','Moto G50','Moto G10 Power','Moto E7i Power','Moto E7 Power','Moto G30',
    'Moto G10','Moto E6i','Edge S','One 5G Ace','Moto G Stylus (2021)','Moto G Power (2021)',
    'Moto G Play (2021)','Moto E7','Moto G 5G','Moto G9 Power','Razr 5G','Moto G9 Plus',
    'Moto E7 Plus','One 5G UW','One 5G','Moto G9 Play','Moto G9 (India)','Moto G 5G Plus',
    'One Fusion','One Fusion+','One Vision Plus','Moto G Fast','Moto E (2020)','Moto G Pro',
    'Edge+ (2020)','Edge','Moto G8 Power Lite','Moto E6s (2020)','Moto G8','Moto G Stylus',
    'Moto G Power','Moto G8 Power','One Hyper','Razr 2019','Moto G8 Play','Moto E6 Play',
    'Moto G8 Plus','One Macro','Moto E6 Plus','One Zoom','One Action','Moto E6',
    'Moto Z4','One Vision','Moto G7 Plus','Moto G7','Moto G7 Power','Moto G7 Play',
    'One (P30 Play)','One Power (P30 Note)','Moto Z3','Moto Z3 Play','Moto E5 Cruise','Moto E5 Play Go',
    'Moto E5 Play','Moto E5 Plus','Moto E5','P30','Moto G6 Play','Moto G6 Plus',
    'Moto G6','Moto X5','Moto X4','Moto G5S Plus','Moto G5S','Moto Z2 Force',
    'Moto E4 Plus','Moto E4 Plus (USA)','Moto E4','Moto E4 (USA)','Moto Z2 Play','Moto C Plus',
    'Moto C','Moto G5 Plus','Moto G5','Moto M','Moto E3 Power','Moto Z Play',
    'Moto E3','Moto Z Force','Moto Z','Moto G4 Plus','Moto G4','Moto G4 Play',
    'Moto G Turbo','Moto X Force','Droid Turbo 2','Droid Maxx 2','Moto X Style','Moto X Play Dual SIM',
    'Moto X Play','Moto G Dual SIM (3rd gen)','Moto 360 Sport (1st gen)','Moto 360 42mm (2nd gen)','Moto 360 46mm (2nd gen)','Moto 360 (1st gen)',
    'Moto G (3rd gen)','Moto E Dual SIM (2nd gen)','Moto E (2nd gen)','Moto G 4G (2nd gen)','Moto G 4G Dual SIM (2nd gen)','Moto Maxx',
    'DROID Turbo','Nexus 6','Moto X (2nd Gen)','Moto G Dual SIM (2nd gen)','Moto G (2nd gen)','Moto G 4G',
    'Luge','Moto E','Moto E Dual SIM','Moto G Dual SIM','Moto G','Moto X',
    'DROID Ultra','DROID Maxx','DROID Mini','RAZR D3 XT919','RAZR D1','Electrify M XT905',
    'RAZR i XT890','DROID RAZR MAXX HD','DROID RAZR HD','RAZR HD XT925','DROID RAZR M','RAZR M XT905',
    'DEFY XT XT556','Electrify 2 XT881','Photon Q 4G LTE XT897','Defy Pro XT560','ATRIX HD MB886','XT760',
    'ATRIX TV XT687','ATRIX TV XT682','MotoGO TV EX440','Motosmart Me XT303','MOTOKEY 3-CHIP EX117','RAZR V XT885',
    'RAZR V XT889','RAZR V MT887','MOTOSMART MIX XT550','MotoGO EX430','Motosmart Flip XT611','XT390',
    'RAZR MAXX','DEFY XT535','GLEAM+ WX308','DROID 4 XT894','DROID RAZR MAXX','Motoluxe MT680',
    'Motoluxe XT389','Motoluxe','Defy Mini XT321','Defy Mini XT320','XT319','WX306',
    'Fire','MT917','XT928','DROID XYBOARD 8.2 MZ609','DROID XYBOARD 10.1 MZ617','XT532',
    'MOTO XT615','EX226','Motokey Social','XOOM 2 Media Edition 3G MZ608','XOOM 2 Media Edition MZ607','XOOM 2 3G MZ616',
    'XOOM 2 MZ615','XOOM Media Edition MZ505','RAZR XT910','DROID RAZR XT912','ATRIX 2 MB865','Admiral XT603',
    'ME632','PRO+','DEFY+','EX212','EX119','MOTOKEY XT EX118',
    'MOTOKEY Mini EX109','MOTOKEY Mini EX108','WX294','FIRE XT','FIRE XT311','SPICE Key XT317',
    'SPICE Key','MILESTONE 3 XT860','DROID 3','Triumph','Photon 4G MB855','EX232',
    'WILDER','MOTO MT870','MOTO MT620','Milestone XT883','MOTO XT882','MOTO XT316',
    'XPRT MB612','GLEAM','PRO','XOOM MZ604','XOOM MZ601','XOOM MZ600',
    'ATRIX','ATRIX 4G','Cliq 2','DROID BIONIC XT875','DROID BIONIC XT865','DROID X ME811',
    'MOTO ME525','MILESTONE 2 ME722','DROID 2 Global','EX122','EX128','MOTOTV EX245',
    'DROID PRO XT610','XT301','SPICE XT300','FLIPSIDE MB508','MOTO MT716','BRAVO MB520',
    'CITRUS WX445','EX300','EX210','EX201','EX115','EX112',
    'CUPE','DEFY','MILESTONE 2','DROID 2','MT810lx','XT810',
    'XT806','A1260','A1680','Grasp WX404','Rambler','CHARM',
    'ES400','DROID X2','DROID X','MILESTONE XT720','XT720 MOTOROI','Quench XT5 XT502',
    'Quench XT3 XT502','WX295','FlipOut','WX290','WX265','WX260',
    'WX181','WX161','QUENCH','BACKFLIP','XT800 ZHISHANG','XT701',
    'MT710 ZHILING','MOTO XT702','MILESTONE','WX395','WX390','WX288',
    'WX280','WX180','WX160','Motocubo A45','DEXT MB220','ROKR ZN50',
    'Karma QA1','L800t','W7 Active Edition','ROKR W6','MC55','ZN300',
    'E11','A3100','A3000','Tundra VA76r','W233 Renew','COCKTAIL VE70',
    'VE66','EM35','Aura','Q 11','VE538','RAZR2 V9x',
    'ZN200','W396','W231','EM30','EM28','EM25',
    'PEBL VU20','MOTOACTV W450','VE75','ZN5','A1210','A1600',
    'A1890','A1800','A810','W388','Z9','Z6w',
    'Z6c','W181','W177','W161','W270','W230',
    'RIZR Z10','ROKR E8','W377','W213','W180','W160',
    'U9','V1100','PEBL U3','RAZR2 V9','RAZR2 V8','ROKR W5',
    'W490','W395','W380','W360','W218','RIZR Z8',
    'KRZR K3','SLVR L9','Q 9h','Q8','W510','W215',
    'W205','ROKR Z6','ROKR E6','SLVR L7e','RAZR maxx V6','RAZR V3xx',
    'RIZR Z3','KRZR K1','W209','W375','W208','MOTOFONE F3',
    'W220','V195','V191','ROKR E2','RAZR V3i','ROKR E1',
    'A910','A1200','A728','A732','E895','V3x',
    'E1070','E770','SLVR L7','PEBL U6','A1010','E1060',
    'E1120','V1050','C261','C257','C168','C139',
    'C123','C118','C117','C113a','C113','C390',
    'E680i','V560','V557','V361','V360','L6',
    'L2','V235','V230','V186','V176','E378i',
    'V635','A668','V980','C980','V535','V547',
    'E375','RAZR V3','Droid Bionic Targa','Droid XTreme','A780','V975',
    'C975','V620','V555','A840','E680','E398',
    'C650','V226','V188','V171','C155','C116',
    'C115','MPx','MPx220','MPx100','V872','V1000',
    'E1000','A1000','A768i','A630','C380/C385','V80',
    'C289','C205','V400p','V220','V180','V878',
    'A925','A920','V750','MPx200','V690','V525',
    'V501','V500','V303','V300','V600','V150',
    'E390','C550','C450','C250','C230','C200',
    'A835','A830','A760','V295','V291','V290',
    'A388c','C350','T725','T720i','T720','T190',
    'E380','E365','E360','V70','C336','C333',
    'C332','C331','C300','V60i','V66i','Accompli 388',
    'V60','Accompli 008','Timeport 280','Timeport 260','Timeport 250','Talkabout T192',
    'Talkabout T191','Accompli 009','V.box(V100)','V66','V50','T180',
    'A6188','v8088','Talkabout T2288','V2288','Timeport P7389','Timeport L7089',
    'V3690','V3688','StarTAC 130','StarTAC 85','StarTAC Rainbow','StarTAC 75+',
    'StarTAC 75','SlimLite','cd930','cd920','M3188','M3288',
    'M3588','M3688','M3788','M3888','d520','Edge 70 Ultra',
    'Moto G36','Moto Z4 Force','Moto Z4 Play','P40','Moto Watch 150',
  ],

  // Nokia — 596 modèles
  'nokia-phones-1': [
    '235 4G (2026)','215 4G (2026)','210 4G','200 4G','110 Power','150 Music',
    '130 Music','110 4G 2nd Edition','105 4G 2nd Edition','108 4G (2024)','110 4G (2024)','105 (2024)',
    '220 4G (2024)','3210','235 4G (2024)','225 4G (2024)','215 4G (2024)','6310 (2024)',
    '5310 (2024)','230 (2024)','C210','G310','150 (2023)','130 (2023)',
    'G42','C300','C110','110 4G (2023)','110 (2023)','106 4G (2023)',
    '106 (2023)','105 4G (2023)','105 (2023)','XR21','C12 Plus','C12 Pro',
    'C32','C22','G22','C02','C12','2780 Flip',
    'X30','G100','G60','C31','T21','G400',
    '110 (2022)','8210 4G','5710 XpressAudio','2760 Flip','2660 Flip','T10',
    'G11 Plus','C200','C100','C21 Plus','C21','105+ (2022)',
    '105 (2022)','C2 2nd Edition','G11','G21','X100','G300',
    'T20','G50','XR20','C30','6310 (2021)','C1 2nd Edition',
    '110 4G','105 4G','C20 Plus','C01 Plus','X20','X10',
    'G20','G10','C20','C10','1.4','5.4',
    'C1 Plus','8000 4G','6300 4G','8 V 5G UW','2 V Tella','225 4G',
    '215 4G','3.4','2.4','C3','C5 Endi','C2 Tennen',
    'C2 Tava','150 (2020)','125','8.3 5G','5.3','1.3',
    '5310 (2020)','C2','C1','2.3','7.2','6.2',
    '800 Tough','2720 V Flip','2720 Flip','220 4G','110 (2019)','105 (2019)',
    '3.1 C','3.1 A','2.2','X71','9 PureView','4.2',
    '3 V','3.2','1 Plus','210','8.1 (Nokia X7)','106 (2018)',
    '3.1 Plus','7.1','6.1 Plus (Nokia X6)','5.1 Plus (Nokia X5)','5.1','3.1',
    '2.1','8110 4G','8 Sirocco','7 plus','6.1','1',
    '3310 4G','2','7','3310 3G','8','105 (2017)',
    '130 (2017)','3','5','6','3310 (2017)','150',
    '216','230 Dual SIM','230','222 Dual SIM','222','105 Dual SIM (2015)',
    '105 (2015)','215','215 Dual SIM','Lumia 638','N1','Lumia 730 Dual SIM',
    'Lumia 735','Lumia 830','130 Dual SIM','130','Lumia 530 Dual SIM','Lumia 530',
    'X2 Dual SIM','225','225 Dual SIM','Lumia 930','Lumia 635','Lumia 630 Dual SIM',
    'Lumia 630','XL','X+','X','Asha 230','220',
    'Lumia Icon','Lumia 525','Lumia 1520','Lumia 1320','Lumia 2520','Asha 503 Dual SIM',
    'Asha 503','Asha 502 Dual SIM','Asha 500 Dual SIM','Asha 500','108 Dual SIM','515',
    '107 Dual SIM','106','Lumia 625','Lumia 1020','208','207',
    'Lumia 925','Lumia 928','Asha 501','Asha 210','Lumia 720','Lumia 520',
    '301','105','Asha 310','Lumia 505','Lumia 620','114',
    '206','Asha 205','109','Lumia 822','Lumia 510','Lumia 810',
    'Asha 309','Asha 308','Lumia 920','Lumia 820','Asha 311','Asha 306',
    'Asha 305','113','112','111','110','Lumia 610 NFC',
    '103','808 PureView','800c','Lumia 610','Asha 302','Asha 203',
    'Asha 202','Lumia 900','Lumia 900 AT&T','801T','X2-02','Lumia 800',
    'Lumia 710 T-Mobile','Lumia 710','Asha 303','Asha 300','Asha 201','Asha 200',
    '603','C2-05','X2-05','C5-06','C5-05','C5-04',
    '101','100','701','700','600','C3-01 Gold Edition',
    '500','N9','C5 5MP','C2-06','C2-03','C2-02',
    '702T','T7','N950','Oro','X1-01','X7-00',
    'E6','C7 Astound','X1-00','X2-01','C2-01','C5-03',
    'E7','C6-01','C7','C3-01 Touch and Type','5250','X3 Touch and Type S',
    'X3-02 Touch and Type','X6 8GB (2010)','X5-01','5233','E73 Mode','C2-00',
    'C1-02','C1-01','C1-00','N8','X2-00','C6',
    'E5','C3 (2010)','C5','C5 TD-SCDMA','X5 TD-SCDMA','6303i classic',
    '5132 XpressMusic','X6 16GB (2010)','2710 Navigation Edition','X6 (2009)','6700 slide','7230',
    '5330 Mobile TV Edition','2690','2220 slide','1800','1616','1280',
    '5235 Comes With Music','6788','N97 mini','X3','N900','5230',
    '3208c','5800 Navigation Edition','6350','Mural','6760 slide','6790 Surge',
    '3720 classic','5530 XpressMusic','E72','3710 fold','6730 classic','6600i slide',
    '7020','2720 fold','2730 classic','E52','6216 classic','5730 XpressMusic',
    '5330 XpressMusic','5030 XpressRadio','N86 8MP','E75','E55','6720 classic',
    '6710 Navigator','5630 XpressMusic','6700 classic','6303 classic','2700 classic','6208c',
    '8800 Gold Arte','N97','6260 slide','E63','7100 Supernova','5130 XpressMusic',
    '2330 classic','2323 classic','1662','1661','1202','5800 XpressMusic',
    'N85','N79','8800 Carbon Arte','3610 fold','7610 Supernova','7510 Supernova',
    '7310 Supernova','7210 Supernova','E71','E66','703','6600 fold',
    '6600 slide','3600 slide','5320 XpressMusic','5220 XpressMusic','6212 classic','5000',
    '7070 Prism','2680 slide','1680 classic','6300i','N96','N78',
    '6220 classic','6210 Navigator','6124 classic','6650 fold','3555','3120 classic',
    '7900 Crystal Prism','2600 classic','1209','3110 Evolve','N82','8800 Sapphire Arte',
    '8800 Arte','6301','E51','E51 camera-free','6263','N81 8GB',
    'N81','N95 8GB','5610 XpressMusic','5310 XpressMusic','6555','7900 Prism',
    '7500 Prism','8600 Luna','6500 slide','6500 classic','N810','3500 classic',
    '2630','6267','2760','2660','1650','1208',
    '1200','6120 classic','6121 classic','5700','5070','E90',
    'E65','E61i','N77','6110 Navigator','N800','3109 classic',
    '3110 classic','N76','N93i','6290','6086','6300',
    '2626','N95','N75','5300','5200','6288',
    '6085','8800 Sirocco','7390','7373','6151','6080',
    '1110i','E50','5500 Sport','N93','N73','N72',
    '2610','2310','1112','6136','6133','6131 NFC',
    '6131','6126','6070','6125','6103','6233',
    '6234','6282','9300i','N92','N80','N71',
    '7380','7370','7360','E70','E62','E61',
    'E60','3250','6708','6280','6270','6111',
    '6060','N91','N90','N70','2652','1600',
    '1110','1101','5140i','8800','6230i','6021',
    '6030','6680','6681','6101','6822','7710',
    '6020','3230','6670','7280','7270','7260',
    '9300','6630','6260','6170','3128','2650',
    '2600','3220','N-Gage QD','3120','7610','9500',
    '5140','6610i','3108','7700','7200','6230',
    '6820','6810','3660','7600','3200','2300',
    '1100','6620','6600','3100','7250i','6108',
    '6220','3300','N-Gage','7250','8910i','6800',
    '6100','5100','2100','6650','3650','3530',
    '3510i','6610','3610','9210i Communicator','7210','6310i',
    '3510','3410','7650','8910','6510','6500',
    '8855','5210','5510','8310','6310','3350',
    '3330','8250','9210 Communicator','3310','8890','8210',
    '8850','8810','6250','6210','7110','9110i Communicator',
    '9000 Communicator','3210 (1999)','6150','6130','6110','5110',
    '3110','8110','2110','G','7.3','9.3 PureView',
    '8.1 Plus','N87',
  ],

  // Nothing — 16 modèles
  'nothing-phones-128': [
    'Phone (4b)','Phone (4a) Pro','Phone (4a)','Phone (3a) Lite','CMF Watch 3 Pro','CMF Watch Pro 2',
    'CMF Watch Pro','Phone (3)','CMF Phone 2 Pro','Phone (3a) Pro','Phone (3a)','Phone (2a) Plus',
    'CMF Phone 1','Phone (2a)','Phone (2)','Phone (1)',
  ],

  // Oneplus — 113 modèles
  'oneplus-phones-95': [
    'N6','Pad 3 Pro','Turbo 6X Pro','Turbo 6X','Nord CE6','Nord CE6 Lite',
    'Ace 6 Ultra','Pad 4','Watch 4','Nord 6','15T','Turbo 6',
    'Turbo 6V','15R','Pad Go 2','Watch Lite','Ace 6T','15',
    'Ace 6','Nord 5','Nord CE5','Watch 3 43mm','Pad Lite','Pad 3',
    '13s','Ace 5 Ultra','Ace 5 Racing','Pad 2 Pro','13T','Watch 3',
    '13R','Ace 5 Pro','Ace 5','Pad 3 (China)','13','Nord 4',
    'Pad 2','Watch 2R','Ace 3 Pro','Pad Pro','Watch 2 (eSIM)','Nord CE4 Lite',
    'Nord CE4 Lite (India)','Ace 3V','Nord CE4','Watch 2','Nord N30 SE','12R',
    '12','Ace 3','Open','Pad Go','Ace 2 Pro','Nord CE3',
    'Nord 3','Nord N30','Nord CE 3 Lite','Ace 2V','Pad','11R',
    'Ace 2','11','Nord N300','Nord Watch','Ace Pro','Nord N20 SE',
    '10T','Nord 2T','Ace Racing','Nord N20 5G','10R 150W','10R',
    'Nord CE 2 Lite 5G','Ace','10 Pro','Nord CE 2 5G','9RT 5G','Nord 2 5G',
    'Nord N200 5G','Nord CE 5G','9 Pro','9','9R','Watch',
    'Nord N10 5G','Nord N100','8T','8T+ 5G','Nord','8 Pro',
    '8','8 5G UW (Verizon)','8 5G (T-Mobile)','7T Pro 5G McLaren','7T Pro','7T',
    '7 Pro 5G','7 Pro','7','6T McLaren','6T','6',
    '5T','5','3T','3','X','2',
    'One','V Fold','Nord 2 Lite','9E','Open 2',
  ],

  // Oppo — 420 modèles
  'oppo-phones-82': [
    'Reno16c','Reno16 Pro','Reno16','Reno16 FS','Reno16 F','Reno16 Pro (China)',
    'Reno16 (China)','Pad 6','Find X9 Ultra','Find X9s Pro','Find X9s','Pad 5 Pro',
    'Pad Mini','Watch X3 Mini','F33 Pro','F33','A6s Pro (China)','A6c',
    'A6k','K15 Pro+','K15 Pro','Find N6','K14','Watch X3',
    'A6s (India)','A6s Pro','K14x','Reno15c (India)','Reno15 FS','A6c (China)',
    'A6t Pro 4G','A6t','A6t 4G','A6','A6 4G','A6x',
    'A6s 4G','A6s','Reno15 Pro (India)','Reno15 Pro Mini','A6 Pro (India)','Reno15 Pro Max',
    'Reno15 Pro','Reno15','Reno15 F','Reno 15c','Pad 5 Matte Display','A6x (India)',
    'A6x 4G','Reno15 Pro (China)','Reno15 (China)','Find X9 Pro','Find X9','Pad 5 (China)',
    'Watch S','A6 Pro','A6 Pro 4G','F31 Pro+','F31 Pro','F31',
    'A6 GT','A6 Pro (China)','A6 Max','K13 Turbo','K13 Turbo Pro','Reno14 F',
    'K13x','A5x','A5','A5 4G','A5x 4G','Reno14 Pro',
    'Reno14','Pad SE','K13','Find X8 Ultra','Find X8s+','Find X8s',
    'Pad 4 Pro','Watch X2 Mini','F29 Pro','F29','A5 Energy','A5 (China)',
    'A5 Pro 4G','A5 Pro','Find N5','Watch X2','Reno13 F','Reno13 F 4G',
    'A5 Pro (China)','Reno13 Pro','Reno13','Pad 3','Find X8 Pro','Find X8',
    'Pad 3 Pro','K12 Plus','A80','F27','A3 4G','A3x 4G',
    'A3','A3x','A3x (China)','K12x','Reno12 F 4G','A3 (China)',
    'Reno12 F','A3 Pro','Reno12 Pro','Reno12','F27 Pro+','Reno12 Pro (China)',
    'Reno12 (China)','K12x (China)','A60','K12','A3 Pro (China)','Watch X',
    'F25 Pro','Reno11 F','Pad Neo','Reno11 Pro','Reno11','Find X7 Ultra',
    'Find X7','A59','Reno11 Pro (China)','Reno11 (China)','Pad Air2','A2',
    'A79','Find N3','A2x','A18','A2 Pro','A38',
    'Watch SE','Watch 4 Pro','Find N3 Flip','A58 4G','K11','Reno10 Pro',
    'Reno10','A78 4G','K11x','Reno10 Pro+','Reno10 Pro (China)','Reno10 (China)',
    'F23','A98','A1','A1x','Find X6 Pro','Find X6',
    'Pad 2','Reno8 T','Reno8 T 5G','A78','A56s','Find N2 Flip',
    'Find N2','A58x','Reno9 Pro+','Reno9 Pro','Reno9','A1 Pro',
    'A58 (China)','A17k','A77s','A17','K10x','A57e',
    'A57s','Reno8 4G','Watch 3 Pro','Watch 3','Reno8 Z','A77 4G',
    'Reno8 Pro','Reno8','A97','Reno8 Lite','K10 5G','A77',
    'A57 4G','Reno8 Pro+','Reno8 Pro (China)','Reno8 (China)','Pad Air','K10 Pro',
    'K10 5G (China)','A55s','A57','Reno7 Lite','F21 Pro 5G','F21 Pro',
    'Reno7','K10','A96','A16e','Reno7 Z 5G','Find X5 Pro',
    'Find X5','Find X5 Lite','Pad','A76','Reno7 5G','Reno6 Lite',
    'A96 (China)','A36','A11s','K9x','Find N','Reno7 Pro 5G',
    'Reno7 5G (China)','Reno7 SE 5G','A95','A16K','A54s','A56 5G',
    'K9s','A55','F19s','K9 Pro','Reno6 Pro 5G (Snapdragon)','Reno6',
    'Watch 2','Reno6 Z','A16s','A16','Reno6 Pro+ 5G','Reno6 Pro 5G',
    'Reno6 5G','K9','A53s 5G','A95 5G','A94 5G','A35',
    'Reno5 Z','A54 5G','A74 5G','A74','F19','A54',
    'Find X3 Pro','Find X3','Find X3 Neo','Find X3 Lite','F19 Pro+ 5G','F19 Pro',
    'Reno5 Lite','A94','Reno5 F','Reno5 K','A55 5G','A93s 5G',
    'A93 5G','A15s','Reno5 4G','Reno5 Pro+ 5G','A53 5G','Reno5 Pro 5G',
    'Reno5 5G','A73 5G','Reno4 F','A15','A53s','A73',
    'A93','Reno4 Z 5G','Reno4 Lite','A33 (2020)','Reno4 SE','F17 Pro',
    'F17','A32','A53','Watch','K7x','Reno4 Pro',
    'Reno4','A72 5G','A12s','Reno4 Pro 5G','Reno4 5G','A92',
    'Find X2 Neo','A92s','A72','A52','A11k','A12',
    'K7 5G','Find X2 Lite','Ace2','A12e','Reno3','Find X2 Pro',
    'Find X2','Reno3 Pro','A31','F15','Reno3 Pro 5G','Reno3 Youth',
    'Reno3 5G','A91','A8','A11','K5','Reno Ace',
    'Reno A','A5 (2020)','A9 (2020)','Reno2','Reno2 F','Reno2 Z',
    'Reno Z','K3','A9x','A9','Reno 5G','Reno 10x zoom',
    'Reno','A1k','A7n','A5s (AX5s)','F11','F11 Pro',
    'A7','R15x','RX17 Neo','K1','A7x','RX17 Pro',
    'R17','F9 (F9 Pro)','A3s','A5 (AX5)','Find X Lamborghini','Find X',
    'F7 Youth','A3 (2018)','F7','R15 Pro','R15','A1 (2018)',
    'A71 (2018)','A83','F5 Youth','R11s Plus','F5','R11s',
    'A71','A77 (2017)','R11 Plus','R11','A77 (Mediatek)','A39',
    'F3','F3 Plus','A57 (2016)','F1s','R9s Plus','R9s',
    'A37','A59 (2016)','R9 Plus','F1 Plus','F1','A53 (2015)',
    'A33 (2015)','Neo 7','R7s','R7 lite','R5s','Mirror 5s',
    'Mirror 5','Joy 3','R7 Plus','R7','Neo 5 (2015)','Neo 5s',
    'Joy Plus','Mirror 3','A31 (2015)','R1x','U3','R5',
    'N3','R1S','Neo 3','Find 5 Mini','R2001 Yoyo','R1001 Joy',
    'Neo 5','R3','N1 mini','Find 7 (2014)','Find 7a (2014)','Neo',
    'R1 R829T','N1','R819','Find 5','U705T Ulike 2','R601',
    'R821T FInd Muse','R811 Real','T29','R817 Real','R815T Clover','Find',
    'U701 Ulike','K14 Turbo','K14 Turbo Pro','Find X9+','F27 Pro','K10 Energy',
  ],

  // Realme — 294 modèles
  'realme-phones-118': [
    'P4x 4G','P4R','Watch S5','16T','C100x','C100i',
    'Narzo 100 Lite','C100 4G','C100','P4 Lite','Note 80','C83',
    'Narzo Power','P4 Lite 4G','16','P4 Power','Neo8','C85 4G',
    '16 Pro+','16 Pro','Pad 3','Narzo 90','Narzo 90X','P3 Lite',
    'P3 Lite 4G','P4x','C85 Pro','C85','GT 8 Pro','GT8 (China)',
    '15x (India)','15 Lite','Watch 5','15','15T','P4',
    'P4 Pro','Narzo 80 Lite','15 Pro','Note 70','15 (India)','Note 70T',
    'Narzo 80 Lite 5G','C73','C71','Neo7 Turbo','GT 7T','GT 7',
    'C75','14T','GT7 (China)','Narzo 80 Pro','Narzo 80x','14',
    'C75x','P3 Ultra','P3','14 Pro Lite','Neo7 SE','Neo7x',
    'P3 Pro','P3x','GT7 Pro Racing','14x','14 Pro','14 Pro+',
    '14x (India)','Neo7','Note 60x','V60 pro','C75 4G','GT 7 Pro',
    'P1 Speed','P2 Pro','Pad 2 Lite','Narzo 70 Turbo','Note 60','13+',
    '13','C63 5G','13 4G','13 Pro+','13 Pro','Watch S2',
    'Narzo N61','C61','GT6 (China)','C61 (India)','12 4G','V60',
    'GT 6','Narzo N63','C63','Narzo N65','GT 6T','GT Neo6',
    'C65 5G','Narzo 70','Narzo 70x','12 Lite','P1 Pro','P1',
    'GT Neo6 SE','12x (India)','C65','12x','Narzo 70 Pro','C51s',
    '12','12+','12 Pro+','12 Pro','Note 50','C67 4G',
    'C67','V50s','GT5 Pro','Narzo 60x','GT5 240W','GT5',
    '11x','11 4G','11','C51','C53 (India)','Pad 2',
    'GT3','Narzo 60 Pro','Narzo 60','C53','Narzo N53','11 Pro+',
    '11 Pro','11 (China)','Narzo N55','GT Neo5 SE','10T','C33 2023',
    'C55','GT Neo 5 240W','GT Neo 5','V30','10s','V20',
    '10 Pro+','10 Pro','10 5G','10','C30s','C33',
    'Watch 3 Pro','9i 5G','Watch 3','GT2 Explorer Master','TechLife Watch R100','Narzo 50i Prime',
    'C30','GT Neo 3T','Pad X','Narzo 50 Pro','Narzo 50 5G','9 5G',
    'V23i','V23','Q5 Pro','Q5','Q5i','9',
    'Pad Mini','C31','GT Neo 3 150W','GT Neo 3','Narzo 50A Prime','TechLife Watch S100',
    '9 5G (India)','9 5G Speed','V25','Narzo 50','9 Pro+','9 Pro',
    'C35','9i','GT2 Pro','GT2','Q3t','GT Neo2T',
    'Q3s','Watch T1','Narzo 50A','Narzo 50i','V11s 5G','GT Neo2',
    'C25Y','8s 5G','8i','Pad','GT Explorer Master','GT Master',
    'C21Y','C11 (2021)','C25s','X7 Max 5G','Narzo 30 5G','Q3 Pro Carnival',
    'GT Neo Flash','Narzo 30','C20A','Watch 2 Pro','Watch 2','Q3 Pro 5G',
    'Q3 5G','Q3i 5G','8 5G','X7 Pro Ultra','GT Neo','V13 5G',
    '8 Pro','8','C25','C21','GT 5G','Narzo 30 Pro 5G',
    'Narzo 30A','V11 5G','C20','X7 (India)','V15 5G','Watch S Pro',
    '7i (Global)','7 5G','Watch S','C15 Qualcomm Edition','Q2 Pro','Q2',
    'Q2i','7','Narzo 20 Pro','Narzo 20','Narzo 20A','C17',
    '7i','7 Pro','7 (Asia)','X7 Pro','X7','V3',
    'C12','V5 5G','C15','6i (India)','X50 5G','C11',
    'X3','C3i','Narzo','X3 SuperZoom','6S','X50 Pro Player',
    'Watch','Narzo 10','Narzo 10A','X50m 5G','6i','6 Pro',
    '6','X50 Pro 5G','C3 (3 cameras)','C3','X50 5G (China)','5i',
    '5s','C2s','C2 2020','X2 Pro','X2','XT',
    'Q','5 Pro','5','3i','X','3 Pro',
    'C2','3','C1 (2019)','U1','2 Pro','C1',
    '2','1','V21','X9 Pro','X9','XT 730G',
  ],

  // Samsung — 300 modèles
  'samsung-phones-9': [
    'Galaxy M47','Galaxy A27','Galaxy A57','Galaxy A37','Galaxy M17e','Galaxy S26 Ultra',
    'Galaxy S26+','Galaxy S26','Galaxy F70e','Galaxy A07','Galaxy Z TriFold','Galaxy M17',
    'Galaxy F07','Galaxy M07','Galaxy A17 4G','Galaxy Tab A11+','Galaxy Tab A11','Galaxy F17',
    'Galaxy S25 FE','Galaxy Tab S11 Ultra','Galaxy Tab S11','Galaxy Tab S10 Lite','Galaxy A07 4G','Galaxy A17',
    'Galaxy F36','Galaxy Z Fold7','Galaxy Z Flip7','Galaxy Z Flip7 FE','Galaxy Watch8 Classic','Galaxy Watch8',
    'Galaxy M36','Galaxy S25 Edge','Galaxy F56','Galaxy M56','Galaxy XCover7 Pro','Galaxy Tab Active5 Pro',
    'Galaxy Tab S10 FE+','Galaxy Tab S10 FE','Galaxy F16','Galaxy A56','Galaxy A36','Galaxy A26',
    'Galaxy M16','Galaxy M06','Galaxy A06 5G','Galaxy F06 5G','Galaxy S25 Ultra','Galaxy S25+',
    'Galaxy S25','Galaxy Z Fold Special','Galaxy A16','Galaxy A16 5G','Galaxy S24 FE','Galaxy Tab S10 Ultra',
    'Galaxy Tab S10+','Galaxy M55s','Galaxy F05','Galaxy M05','Galaxy A06','Galaxy F14 4G',
    'Galaxy Z Fold6','Galaxy Z Flip6','Galaxy Watch Ultra','Galaxy Watch7','Galaxy Watch FE','Galaxy M35',
    'Galaxy F55','Galaxy C55','Galaxy M55','Galaxy Tab S6 Lite (2024)','Galaxy A55','Galaxy A35',
    'Galaxy M15','Galaxy M14 4G','Galaxy F15','Galaxy S24 Ultra','Galaxy S24+','Galaxy S24',
    'Galaxy XCover7','Galaxy Tab Active5','Galaxy A25','Galaxy A15 5G','Galaxy A15','Galaxy Tab A9+',
    'Galaxy Tab A9','Galaxy S23 FE','Galaxy Tab S9 FE+','Galaxy Tab S9 FE','Galaxy A05s','Galaxy A05',
    'Galaxy F34','Galaxy Z Fold5','Galaxy Z Flip5','Galaxy Tab S9 Ultra','Galaxy Tab S9+','Galaxy Tab S9',
    'Galaxy Watch6 Classic','Galaxy Watch6','Galaxy M34 5G','Galaxy F54','Galaxy A24 4G','Galaxy F14',
    'Galaxy M54','Galaxy A54','Galaxy A34','Galaxy M14','Galaxy S23 Ultra','Galaxy S23+',
    'Galaxy S23','Galaxy A14','Galaxy A14 5G','Galaxy F04','Galaxy M04','Galaxy Tab A7 10.4 (2022)',
    'Galaxy A04e','Galaxy Tab Active4 Pro','Galaxy A04s','Galaxy A04','Galaxy Z Fold4','Galaxy Z Flip4',
    'Galaxy Watch5 Pro','Galaxy Watch5','Galaxy A23 5G','Galaxy M13 5G','Galaxy M13 (India)','Galaxy A13 (SM-A137)',
    'Galaxy XCover6 Pro','Galaxy F13','Galaxy M13','Galaxy Tab S6 Lite (2022)','Galaxy M53','Galaxy S20 FE 2022',
    'Galaxy A73 5G','Galaxy A53 5G','Galaxy A33 5G','Galaxy F23','Galaxy M33','Galaxy M23',
    'Galaxy A23','Galaxy A13','Galaxy S22 Ultra 5G','Galaxy S22+ 5G','Galaxy S22 5G','Galaxy Tab S8 Ultra',
    'Galaxy Tab S8+','Galaxy Tab S8','Galaxy S21 FE 5G','Galaxy Tab A8 10.5 (2021)','Galaxy A13 5G','Galaxy A03',
    'Galaxy A03 Core','Galaxy F42 5G','Galaxy M52 5G','Galaxy M22','Galaxy M32 5G','Galaxy A03s',
    'Galaxy A52s 5G','Galaxy Z Fold3 5G','Galaxy Z Flip3 5G','Galaxy Watch4 Classic','Galaxy Watch4','Galaxy A12 (India)',
    'Galaxy A12 Nacho','Galaxy M21 2021','Galaxy F22','Galaxy M32','Galaxy A22 5G','Galaxy A22',
    'Galaxy Tab A7 Lite','Galaxy Tab S7 FE','Galaxy F52 5G','Galaxy M42 5G','Galaxy M12','Galaxy Quantum 2',
    'Galaxy F12','Galaxy F02s','Galaxy A72','Galaxy A52 5G','Galaxy A52','Galaxy XCover 5',
    'Galaxy A32','Galaxy M62','Galaxy F62','Galaxy M12 (India)','Galaxy S21 Ultra 5G','Galaxy S21+ 5G',
    'Galaxy S21 5G','Galaxy A32 5G','Galaxy M02s','Galaxy A12','Galaxy M02','Galaxy A02',
    'Galaxy A02s','Galaxy M21s','Galaxy M31 Prime','Galaxy F41','Galaxy Tab Active3','Galaxy S20 FE 5G',
    'Galaxy S20 FE','Galaxy A42 5G','Galaxy Tab A7 10.4 (2020)','Galaxy M51','Galaxy A51 5G UW','Galaxy Z Fold2 5G',
    'Galaxy Note20 Ultra 5G','Galaxy Note20 Ultra','Galaxy Note20 5G','Galaxy Note20','Galaxy Watch3','Galaxy Tab S7+',
    'Galaxy Tab S7','Galaxy Z Flip 5G','Galaxy M31s','Galaxy M01s','Galaxy M01 Core','Galaxy A01 Core',
    'Galaxy A71 5G UW','Galaxy M01','Galaxy A21s','Galaxy J2 Core (2020)','Galaxy A Quantum','Galaxy A71 5G',
    'Galaxy A51 5G','Galaxy A21','Galaxy Tab A 8.4 (2020)','Galaxy Tab S6 Lite (2020)','Galaxy M11','Galaxy A31',
    'Galaxy A41','Galaxy M21','Galaxy A11','Galaxy M31','Galaxy S20 Ultra 5G','Galaxy S20 Ultra',
    'Galaxy S20+ 5G','Galaxy S20+','Galaxy S20 5G UW','Galaxy S20 5G','Galaxy S20','Galaxy Z Flip',
    'Galaxy Tab S6 5G','Galaxy XCover Pro','Galaxy Note10 Lite','Galaxy S10 Lite','Galaxy A01','Galaxy A71',
    'Galaxy A51','Galaxy XCover FieldPro','Galaxy A70s','Galaxy A20s','Galaxy M30s','Galaxy M10s',
    'Galaxy Fold 5G','Galaxy Fold','Galaxy Tab Active Pro','Galaxy A90 5G','Galaxy A30s','Galaxy A50s',
    'Galaxy Note10+ 5G','Galaxy Note10+','Galaxy Note10 5G','Galaxy Note10','Galaxy Watch Active2','Galaxy Watch Active2 Aluminum',
    'Galaxy A10s','Galaxy A10e','Galaxy Tab S6','Galaxy Tab A 8.0 (2019)','Galaxy XCover 4s','Galaxy A2 Core',
    'Galaxy Watch Active','Galaxy View2','Galaxy S10 5G','Galaxy S10+','Galaxy S10','Galaxy S10e',
    'Galaxy M40','Galaxy M30','Galaxy M20','Galaxy M10','Galaxy A80','Galaxy A70',
    'Galaxy A60','Galaxy A50','Galaxy A40','Galaxy A30','Galaxy A20e','Galaxy A20',
    'Galaxy A10','Galaxy Tab S5e','Galaxy Tab A 10.1 (2019)','Galaxy Tab A 8.0 & S Pen (2019)','Galaxy Tab Advanced2','Galaxy Tab A 8.0 (2018)',
    'Galaxy Tab S4 10.5','Galaxy Tab A 10.5','Galaxy A8s','Galaxy A6s (2018)','Galaxy A9 (2018)','Galaxy A7 (2018)',
  ],

  // Sony — 163 modèles
  'sony-phones-7': [
    'Xperia 1 VIII','Xperia 10 VII','Xperia 1 VII','Xperia 1 VI','Xperia 10 VI','Xperia 5 V',
    'Xperia 1 V','Xperia 10 V','Xperia 5 IV','Xperia 1 IV','Xperia 10 IV','Xperia Pro-I',
    'Xperia 10 III Lite','Xperia 1 III','Xperia 5 III','Xperia 10 III','Xperia Pro','Xperia 5 II',
    'Xperia 1 II','Xperia 10 II','Xperia L4','Xperia 5','Xperia 1','Xperia 10 Plus',
    'Xperia 10','Xperia L3','Xperia XA2 Plus','Xperia XZ3','Xperia XZ2 Premium','Xperia XZ2',
    'Xperia XZ2 Compact','Xperia XA2 Ultra','Xperia XA2','Xperia L2','Xperia R1 (Plus)','Xperia XZ1',
    'Xperia XA1 Plus','Xperia XZ1 Compact','Xperia L1','Xperia XZs','Xperia XZ Premium','Xperia XA1 Ultra',
    'Xperia XA1','Xperia X Compact','Xperia XZ','Xperia E5','Xperia XA Ultra','Xperia X Performance',
    'Xperia X','Xperia XA Dual','Xperia XA','Xperia Z5 Premium Dual','Xperia Z5 Premium','Xperia Z5 Dual',
    'Xperia Z5','Xperia Z5 Compact','Xperia M5 Dual','Xperia M5','Xperia C5 Ultra Dual','Xperia C5 Ultra',
    'Xperia Z4v','Xperia Z3+ dual','Xperia Z3+','Xperia C4 Dual','Xperia C4','Xperia M4 Aqua Dual',
    'Xperia M4 Aqua','Xperia Z4 Tablet WiFi','Xperia Z4 Tablet LTE','Xperia E4g','Xperia E4g Dual','Xperia E4 Dual',
    'Xperia E4','Xperia E3 Dual','Xperia E3','Xperia Z3 Tablet Compact','Xperia Z3 Dual','Xperia Z3v',
    'Xperia Z3','Xperia M2 Aqua','Xperia Z3 Compact','Xperia C3 Dual','Xperia C3','Xperia Z2a',
    'Xperia T3','SmartWatch 3 SWR50','SmartWatch 2 SW2','Xperia M2','Xperia M2 dual','Xperia Z2 Tablet LTE',
    'Xperia Z2 Tablet Wi-Fi','Xperia Z2','Xperia E1 dual','Xperia E1','Xperia T2 Ultra dual','Xperia T2 Ultra',
    'Xperia Z1s','Xperia Z1 Compact','Xperia Z1','Xperia Z Ultra','Xperia C','Xperia M',
    'Xperia ZR','Xperia L','Xperia SP','Xperia Tablet Z Wi-Fi','Xperia Tablet Z LTE','Xperia Z',
    'Xperia ZL','Xperia E dual','Xperia E','Xperia T LTE','Xperia Tablet S 3G','Xperia Tablet S',
    'Xperia V','Xperia J','Xperia TX','Xperia T','Xperia SL','Xperia tipo dual',
    'Xperia tipo','Xperia miro','Xperia go','Xperia acro S','Xperia SX SO-05D','Xperia GX SO-04D',
    'Xperia acro HD SO-03D','Xperia acro HD SOI12','Xperia neo L','Xperia sola','Xperia U','Xperia P',
    'Xperia S','Xperia ion HSPA','Xperia ion LTE','Tablet P','Tablet P 3G','Tablet S 3G',
    'Tablet S','CMD Z7','Xperia LT29i Hayabusa','CMD J70','CMD J7','CMD MZ5',
    'CMD J6','CMD J5','CMD Z5','CMD CD5','CMD C1','CMD Z1 plus',
    'CMD Z1','CM-DX 2000','CM-DX 1000','Xperia 5 Plus','Xperia X Ultra','Xperia H8541',
    'Xperia M Ultra','Xperia X Premium','Xperia E1 II','Xperia Z4 Ultra','Xperia Z4 Compact','D 2403',
    'Xperia C670X',
  ],

  // Vivo — 602 modèles
  'vivo-phones-98': [
    'Y500','iQOO Z11i','X Fold6','IQOO Pad5c','V70 Lite','S60',
    'S60e','T5','Y600 Turbo','iQOO 15T','iQOO Pad6 Pro','iQOO Z11',
    'Y600 Pro','Y500s','Y6','Y6t','Y60','X300 FE',
    'T5 Pro','X300 Ultra','X300s','Pad6 Pro','iQOO Z11 (China)','iQOO Z11x (China)',
    'Y21','Y11','T5x','iQOO Z11x','Y51 Pro','V70 FE',
    'X300 FE (Russia)','iQOO 15R','Y05','V70 Elite','V70','iQOO 15 Ultra',
    'X200T','iQOO Z11 Turbo','Y31d','Y500i','S50 Pro mini','S50',
    'Y500 Pro','Y21d','Y19s','iQOO Neo11 (China)','iQOO 15','X300 Pro',
    'X300','Pad5e','Watch GT 2','V60e','V60 Lite','V60 Lite 4G',
    'Y31 Pro','Y31','Y500 (China)','T4 Pro','V60','iQOO Z10 Turbo+',
    'Y19s GT','Y400','Y400 4G','T4R','Y50 (China)','iQOO Z10R (India)',
    'X Fold5','T4 Lite','X200 FE','Y400 Pro','iQOO Z10 Lite','T4 Ultra',
    'Y19s Pro','Pad5','S30 Pro mini','S30','iQOO Neo 10','IQOO Pad5 Pro',
    'IQOO Pad5','iQOO Neo10 Pro+ (China)','Y300 GT','Y19','iQOO Z10 Turbo Pro','iQOO Z10 Turbo',
    'T4','X200 Ultra','X200s','Pad5 Pro','Pad SE','Watch 5',
    'iQOO Z10','iQOO Z10x','V50e','Y300t','Y300 Pro+','Y39',
    'V50 Lite','V50 Lite 4G','Y29s','iQOO Neo 10R','Y300i','T4x',
    'Y04','Y29 4G','V50','Y200 4G','Y200 (Asia)','Y200',
    'iQOO Z9 Turbo Endurance','Y200+','Y29','Y300 (China)','iQOO Neo10 Pro (China)','iQOO Neo10 (China)',
    'S20 Pro','S20','Y300','Y18t','iQOO 13','Y300 Plus',
    'X200 Pro mini','X200 Pro','X200','Y19s 4G','V40 Lite 4G (IDN)','V40 Lite (IDN)',
    'V40e','iQOO Z9 Turbo+','T3 Ultra','Y300 Pro','Y37 Pro','Y37',
    'T3 Pro','Y18i','Y03t','iQOO Z9s Pro','iQOO Z9s','V40 Pro',
    'V40 Lite','iQOO Z9 Lite','iQOO Watch GT','iQOO Neo9S Pro+','V40','Pad3',
    'T3 Lite','Y28s','Y28 4G','Y58','iQOO Pad2 Pro','iQOO Pad2',
    'S19 Pro','S19','Watch GT','Y200 Pro','iQOO Neo9S Pro','Y200 GT',
    'Y200 (China)','Y200t','X100 Ultra','X100s Pro','X100s','Y18',
    'Y18 (India)','Y18e','Y100 4G','V30e','Y38','V30 SE',
    'iQOO Z9 Turbo','iQOO Z9x','iQOO Z9 (China)','iQOO Watch','Y200i','T3x',
    'V30 Lite 4G','V30 Lite (ME)','V40 SE','X Fold3 Pro','X Fold3','Pad3 Pro',
    'T3','Y03','iQOO Z9','V30 Pro','Y100t','iQOO Neo9 Pro',
    'Y200e','V30','Y100 (IDN)','Y28','G2','V30 Lite',
    'iQOO Neo9 Pro (China)','iQOO Neo9','S18 Pro','S18','S18e','Y36i',
    'Y100i','X100 Pro','X100','Watch 3','iQOO 12 Pro','iQOO 12',
    'Y27s','Y100 (China)','T2','V29e','Y200 (India)','Y78t',
    'V29 Pro','iQOO Z8x','iQOO Z8 (China)','T2 Pro','Y17s','iQOO Z7 Pro',
    'V29e (India)','Pad Air','Y77t','V29','Y27 5G','Y27',
    'Y02t','iQOO 11S','iQOO Neo 7 Pro','X90s','Y36 (India)','Y36 5G',
    'Y36','V29 Lite','S17 Pro','S17','S17t','Y35+',
    'Y78','S17e','iQOO Neo8 Pro','iQOO Neo8','iQOO Pad','iQOO Z7s',
    'Y78 (China)','Y78+','X Fold2','X Flip','Pad2','T2 (India)',
    'T2x (India)','Y11 (2023)','Y02A','iQOO Z7','iQOO Z7 (China)','iQOO Z7x',
    'iQOO Z7i','V27 Pro','V27','V27e','Y56','Y100',
    'iQOO Neo 7','Y55s (2023)','iQOO Neo7 Racing','S16 Pro','S16','S16e',
    'Y35 5G','iQOO 11 Pro','iQOO 11','iQOO Neo7 SE','Y02','X90 Pro+',
    'X90 Pro','X90','V21s','iQOO Neo7 (China)','Y73t','X Fold+',
    'X80 Lite','Y52t','iQOO Z6 Lite','Y16','Y75s','Y22',
    'V25e','iQOO Z6 (China)','iQOO Z6x','Y22s (Europe)','Y22s','Y77e (t1)',
    'V25 Pro','V25','Y35','Y77e','Y02s','iQOO 9T',
    'Y30 5G','T1x (India)','iQOO 10 Pro','iQOO 10','Y77 (China)','Y77',
    'iQOO U5e','iQOO Neo 6','Y33e','T2x','Y72t','T2 (China)',
    'Y75','S15 Pro','S15','iQOO Neo6 SE','T1 Pro','T1 (Snapdragon 680)',
    'iQOO Z6 Pro','Y55','iQOO Z6 44W','X80 Pro','X80','T1 (Snapdragon 778G)',
    'T1x 4G','S15e','iQOO Neo6 (China)','X Note','X Fold','Pad',
    'Y21G','iQOO U5x','iQOO Z6','Y01','Y33s 5G','iQOO 9',
    'iQOO 9 SE','iQOO 9 Pro','T1 5G','Y33','Y75 5G','Y55 5G',
    'iQOO 9 (China)','V23 Pro','V23 5G','Y33t','Y21t (India)','Y21a',
    'Y21e','Y21t','iQOO U5','S12 Pro','S12','Watch 2',
    'iQOO Neo5 S','iQOO Neo5 SE','Y32','Y55s (2021)','V23e 5G','Y76 5G',
    'Y54s','V23e','Y50t','Y15a','Y74s','Y76s',
    'Y15s','Y71t','iQOO Z5x','T1x','T1','Y3s (2021)',
    'S10e','Y20t','iQOO Z5','Y21s','X70 Pro+','X70 Pro',
    'X70','Y33s','Y21 (2021)','iQOO 8 Pro','iQOO U3x Standard','iQOO 8',
    'Y12a','S10 Pro','S10','Y73','Y72 5G (India)','Y53s 4G',
    'X60t Pro+','V21e 5G','Y53s','Y70t','X60s','iQOO Neo5 Lite',
    'Y52 5G','Y12s 2021','Y52s t1','V21 5G','V21','V21e',
    'iQOO 7 (India)','Y20s [G]','X60t','Y30g','X60 Pro','X60',
    'iQOO Z3','Y72 5G','iQOO U3x','iQOO Neo5','S9','S9e',
    'S7t','X60 Pro+','Y31 (2021)','Y20g','Y31s','iQOO 7',
    'Y20a','Y20 2021','X60 Pro (China)','X60 (China)','V20 2021','Y30 Standard',
    'iQOO U3','Y52s','Y51a','Y51 (2020, December)','Y12s','Y12i',
    'Y1s','S7e','X51 5G','iQOO U1x','Y3s','Y30 (China)',
    'Y11s','Y70','Y20s','Y73s','X50e','V20',
    'Watch','V20 SE','V20 Pro','Y51 (2020, September)','Y20i','Y20',
    'iQOO 5 Pro 5G','iQOO 5 5G','S1 Prime','S7','iQOO U1','Y51s',
    'iQOO Z1x','V19 Neo','Z5x (2020)','X50 Pro+','X50 Pro','X50 5G',
    'X50','Y70s','iQOO Z1','X50 Lite','Y30','iQOO Neo3 5G',
    'Y50 (2020)','V19','S6 5G','NEX 3S 5G','V19 (Indonesia)','Z6 5G',
    'iQOO 3 5G','X30 Pro','X30','V17','iQOO Neo 855 Racing','Y9s',
    'Z5i','V17 (Russia)','S1 Pro','S5','U20','Y3 Standard',
    'Y5s','Y19 (2019)','iQOO Neo 855','Y11 (2019)','U3','U10',
    'Y3 (4GB+64GB)','Y3','V17 Pro','NEX 3 5G','NEX 3','Z1x',
    'iQOO Pro 5G','iQOO Pro','Y90','V17 Neo','Z5','S1',
    'Z1Pro','iQOO Neo','Z5x','S1 Pro (China)','Z3x','Y17',
    'Y15','Y12','X27 Pro','S1 (China)','X27','V15',
    'iQOO','V15 Pro','Y89','NEX Dual Display','Y93 (Mediatek)','Y93s',
    'Z1 Lite','Y95','Y91i','Y93','Y91i (India)','Y91 (Mediatek)',
    'Y91','Y81i','Z3','Z3i','Y71i','V11i',
    'Y97','X23','V11 (V11 Pro)','Y83 Pro','Z1i','V9 6GB',
    'NEX S','NEX A','Z1','Y83','Y81','X21i',
    'Y53i','Y71','V9 Youth','V9','X21 UD','X21',
    'V7','X20 Plus UD','X20 Plus','X20','V7+','Y65',
    'Y69','Y53','X9s Plus','X9s','V5s','Y25',
    'Y55L (vivo 1603)','Y55s (2017)','V5 Lite (vivo 1609)','V5 Plus','Y67','Xplay6',
    'X9 Plus','X9','V5','X7 Plus','X7','V3Max',
    'V3','X6S Plus','X6S','Xplay5 Elite','Xplay5','Y51 (2015)',
    'X6','X6Plus','V1','Y15S (2015)','V1 Max','Y31 (2015)',
    'Y37 (2015)','Y35 (2015)','X5Max Platinum Edition','X5Pro','X5Max+','X5Max',
    'Y11','X5','Xplay3S','Xshot','X3S','Y28 (2014)',
    'Y27 (2014)','Y22 (2013)','Y15 (2013)','S21 Pro','iQOO U6','iQOO Z5 (2022)',
    'X80 Pro+','Xplay7',
  ],

  // Xiaomi — 526 modèles
  'xiaomi-phones-80': [
    'Redmi K90 Ultra','Redmi 17C','17T Pro','17T','Watch S5 46mm','17 Max',
    'Poco Pad C1','Black Shark Pad SE','Poco C81 Pro','Poco C81','Poco C81x','Redmi K90 Max',
    'Redmi K Pad 2','Redmi Pad 2 9.7','Redmi A7 Pro','Redmi A7','Poco M8s','Redmi R70m',
    'Redmi R70','Redmi Note 15 Special','Redmi A7 Pro 4G','Redmi 15a','Poco X8 Pro Max','Poco X8 Pro',
    'Poco C85x','17 Ultra','17','Pad 8 Pro','Watch 5','Redmi Turbo 5 Max',
    'Redmi Turbo 5','Black Shark Gaming Tablet','Poco M8 Pro','Poco M8','17 Ultra (China)','Redmi Note 15 Pro+',
    'Redmi Note 15 Pro','Redmi Note 15','Redmi Note 15 Pro 4G','Redmi Note 15 4G','Poco C85','Poco F8 Ultra',
    'Poco F8 Pro','Poco Pad X1','Poco Pad M1','Black Shark GS3 Ultra','Black Shark GS3','Redmi K90',
    'Redmi K90 Pro Max','Redmi Watch 6','17 Pro Max','17 Pro','Black Shark Pad 7 Pro','Black Shark Pad 7',
    'Pad 8','15T Pro','15T','Redmi Pad 2 Pro','Pad Mini','Redmi 15C',
    'Poco C85 4G','Redmi Note 15 Pro+ (China)','Redmi Note 15 Pro (China)','Redmi Note 15 (China)','Poco M7 4G','Poco M7 Plus',
    'Redmi 15 4G','Redmi 15','Redmi 15C 4G','Redmi K80 Ultra','Mix Flip 2','Watch S4 41mm',
    'Pad 7S Pro 12.5','Redmi K Pad','Poco F7','Redmi Pad 2','15S Pro','Civi 5 Pro',
    'Pad 7 Ultra','Redmi Turbo 4 Pro','Redmi Watch Move','Poco C71','Poco F7 Ultra','Poco F7 Pro',
    'Redmi 13x','Redmi A5','Redmi Note 14S','15 Ultra','15','Black Shark Pad 6',
    'Poco M7','Redmi Note 14 Pro+ 5G','Redmi Note 14 Pro 5G','Redmi Note 14 Pro 4G','Redmi Note 14 5G','Redmi Note 14 4G',
    'Poco X7 Pro','Poco X7','Redmi 14C 5G','Redmi 14C (China)','Redmi Turbo 4','Poco M7 Pro 5G',
    'Poco C75 5G','Redmi Note 14 5G (India)','Redmi Note 14 Pro 5G (India)','Redmi Note 14 Pro+ 5G (India)','Redmi K80 Pro','Redmi K80',
    'Pad 7 Pro','Pad 7','Redmi Watch 5','Watch S4','15 Pro','Poco C75',
    'Redmi A4','Redmi A3 Pro','14T Pro','14T','Redmi Note 14 5G (China)','Redmi 14R',
    'Redmi 14C','Redmi Watch 5 Lite','Redmi Watch 5 Active','Poco Pad 5G','Poco M6 Plus','Redmi Pad SE 8.7',
    'Mix Flip','Redmi K70 Ultra','Mix Fold 4','Watch S4 Sport','Redmi 13 5G','Poco M6 4G',
    '14 Civi','Redmi 13','Redmi Pad Pro 5G','Redmi A3x','Poco F6 Pro','Poco F6',
    'Poco Pad','Redmi Note 13R','Redmi Pad Pro','Redmi Turbo 3','Poco C61','Civi 4 Pro',
    'Poco X6 Neo','14','14 Ultra','Pad 6S Pro 12.4','Watch 2','Watch S3',
    'Redmi A3','Redmi Note 13 Pro 4G','Redmi Note 13 4G','Redmi Note 13 Pro+','Redmi Note 13 Pro','Redmi Note 13',
    'Poco X6 Pro','Poco X6','Poco M6 Pro 4G','Poco M6','Redmi 13R','Redmi 13C 5G',
    'Redmi K70 Pro','Redmi K70','Redmi K70E','Redmi Watch 4','Redmi Note 13R Pro','Redmi 13C',
    'Poco C65','14 Pro','13T Pro','13T','Watch 2 Pro','Redmi Note 13 (China)',
    'Redmi Pad SE','Redmi K60 Ultra','Mix Fold 3','Pad 6 Max 14','Poco M6 Pro','Redmi Watch 3 Active',
    'Redmi 12 5G','Redmi Note 12R','Redmi Note 12R Pro','Redmi 12','Redmi Note 12T Pro','Civi 3',
    'Poco F5 Pro','Poco F5','13 Ultra','Pad 6 Pro','Pad 6','Poco C51',
    'Redmi Note 12S','Redmi Note 12 Pro 4G','Redmi Note 12 Turbo','Redmi A2+','Redmi A2','Redmi Note 12 4G',
    '13 Pro','13','13 Lite','Poco C55','Poco X5 Pro','Poco X5',
    'Redmi Note 12','Poco C50','Redmi Note 12 Pro Speed','Redmi K60 Pro','Redmi K60E','Redmi K60',
    'Redmi Watch 3','Watch S2','Redmi 12C','Redmi Note 12 Discovery','Redmi Note 12 Pro+','Redmi Note 12 Pro',
    'Redmi Note 12 (China)','12T Pro','12T','Redmi Pad','Redmi Note 11R','Redmi A1+',
    'Civi 2','Redmi 11 Prime','Redmi 11 Prime 5G','Redmi A1','Poco M5s','Poco M5',
    'Poco M5 (India)','Redmi Note 11 SE (India)','Poco M4 5G','Watch S1 Pro','Redmi K50 Ultra','Mix Fold 2',
    'Pad 5 Pro 12.4','Redmi K50i','12 Lite','12S Ultra','12S Pro','12S',
    '12 Pro (Dimensity)','Poco F4','Poco X4 GT','Poco C40','Redmi Note 11T Pro+','Redmi Note 11T Pro',
    'Redmi Note 11SE','Redmi 10 Prime 2022','Poco M4 5G (India)','Poco F4 GT','Poco Watch','Civi 1S',
    'Redmi 10 Power','Black Shark 5 Pro','Black Shark 5','Black Shark 5 RS','Redmi 10A','Redmi Note 11S 5G',
    'Redmi 10 5G','Redmi Note 11 Pro+ 5G','Redmi K50 Pro','Redmi K50','Redmi K40S','12 Pro',
    '12','12X','Watch S1 Active','Redmi 10 (India)','Redmi 10C','Redmi Note 11 Pro+ 5G (India)',
    'Redmi Note 11E Pro','Redmi Note 11E','Poco X4 Pro 5G','Poco M4 Pro','Redmi K50 Gaming','Redmi 10 2022',
    'Redmi Note 11 Pro 5G','Redmi Note 11 Pro','Redmi Note 11S','Redmi Note 11','11i HyperCharge 5G','11i',
    'Watch S1','Redmi Note 11T 5G','Redmi Note 11 4G','Poco M4 Pro 5G','Redmi Note 11 Pro (China)','Redmi Note 11 (China)',
    'Redmi Watch 2 Lite','Redmi Watch 2','Black Shark 4S Pro','Black Shark 4S','Redmi Note 10 Lite','Civi',
    'Watch Color 2','Redmi 9i Sport','Redmi 9A Sport','Poco C31','Redmi 9 Activ','11T Pro',
    '11T','11 Lite 5G NE','Redmi 10 Prime','Redmi 10','Pad 5 Pro','Pad 5',
    'Mix 4','Poco X3 GT','Poco F3 GT','Redmi Note 10T 5G','Mi Watch Revolve Active','Redmi Note 10 Pro (China)',
    'Redmi Note 8 2021','Poco M3 Pro 5G','Redmi K40 Gaming','Mi 11X Pro','Mi 11X','Poco M2 Reloaded',
    'Mi Mix Fold','Mi 11 Ultra','Mi 11 Pro','Mi 11i','Mi 11 Lite 5G','Mi 11 Lite',
    'Black Shark 4 Pro','Black Shark 4','Poco X3 Pro','Poco F3','Mi 10S','Redmi Note 10 Pro',
    'Redmi Note 10 5G','Redmi Note 10S','Redmi Note 10','Redmi Note 10 Pro Max','Redmi Note 10 Pro (India)','Redmi K40 Pro+',
    'Redmi K40 Pro','Redmi K40','Redmi Note 9T','Redmi 9T','Mi 10i 5G','Mi 11',
    'Redmi 9 Power','Mi Watch Lite','Redmi Note 9 Pro 5G','Redmi Note 9 5G','Redmi Note 9 4G','Redmi Watch',
    'Poco M3','Redmi K30S','Mi Watch Color Sports','Poco C3','Mi 10T Pro 5G','Mi 10T 5G',
    'Mi 10T Lite 5G','Mi Watch','Mi Watch Revolve','Redmi 9AT','Redmi 9i','Poco M2',
    'Poco X3','Poco X3 NFC','Redmi 9 (India)','Mi 10 Ultra','Redmi K30 Ultra','Redmi 9 Prime',
    'Black Shark 3S','Poco M2 Pro','Redmi 9A','Redmi 9C NFC','Redmi 9C','Redmi 9',
    'Redmi 10X Pro 5G','Redmi 10X 5G','Redmi 10X 4G','Redmi K30i 5G','Poco F2 Pro','Redmi K30 5G Racing',
    'Redmi Note 9 Pro','Redmi Note 9','Mi Note 10 Lite','Mi 10 Youth 5G','Mi 10 Lite 5G','Redmi K30 Pro Zoom',
    'Redmi K30 Pro','Redmi Note 9S','Redmi Note 9 Pro Max','Redmi Note 9 Pro (India)','Black Shark 3 Pro','Black Shark 3',
    'Mi 10 Pro 5G','Mi 10 5G','Redmi 8A Pro','Redmi 8A Dual','Poco X2','Redmi K30',
    'Redmi K30 5G','Redmi Note 8T','Mi Note 10 Pro','Mi Note 10','Mi CC9 Pro','Watch Color',
    'Mi Watch (China)','Redmi 8','Redmi 8A','Mi Mix Alpha','Mi 9 Pro 5G','Mi 9 Pro',
    'Redmi K20 Pro Premium','Mi 9 Lite','Redmi Note 8 Pro','Black Shark 2 Pro','Mi A3','Redmi 7A',
    'Mi CC9e','Mi CC9','Redmi Note 8','Mi 9T Pro','Mi 9T','Redmi K20',
    'Redmi K20 Pro','Redmi Note 7S','Redmi Y3','Black Shark 2','Redmi 7','Redmi Note 7 Pro',
    'Mi Mix 3 5G','Mi 9 Explorer','Mi 9 SE','Mi 9','Redmi Go','Redmi Note 7',
    'Mi Play','Black Shark Helo','Mi Mix 3','Redmi Note 6 Pro','Mi 8 Pro','Mi 8 Lite',
    'Pocophone F1','Mi A2 (Mi 6X)','Mi A2 Lite (Redmi 6 Pro)','Mi Max 3','Mi Pad 4 Plus','Mi Pad 4',
    'Redmi 6','Redmi 6A','Mi 8 Explorer','Mi 8','Mi 8 SE','Redmi S2 (Redmi Y2)',
    'Mi Mix 2S','Redmi Note 5 AI Dual Camera','Redmi Note 5 Pro','Black Shark','Redmi 5 Plus (Redmi Note 5)','Redmi 5',
    'Redmi 5A','Redmi Y1 (Note 5A)','Redmi Y1 Lite','Mi Note 3','Mi Mix 2','Mi A1 (Mi 5X)',
    'Mi Max 2','Redmi 4 (4X)','Mi 6','Mi Pad 3','Mi 5c','Redmi Note 4X',
    'Redmi Note 4','Redmi 4A','Redmi 4 (China)','Mi 6 Plus','Redmi 4 Prime','Mi Mix',
    'Mi Note 2','Mi 5s Plus','Mi 5s','Redmi Note 4 (MediaTek)','Redmi Pro','Redmi 3x',
    'Redmi 3s Prime','Redmi 3s','Redmi 3 Pro','Mi Max','Mi 5','Mi 4s',
    'Redmi Note 3','Redmi 3','Redmi Note Prime','Mi Pad 2','Redmi Note 3 (MediaTek)','Mi 4c',
    'Redmi Note 2','Redmi 2 Pro','Redmi 2 Prime','Mi 4i','Mi Note Pro','Mi Note',
    'Redmi 2A','Redmi 2','Mi 4 LTE','Redmi Note 4G','Mi 4','Mi Pad 7.9',
    'Redmi Note','Mi 3','Redmi 1S','Redmi','Mi 2A','Mi 2S',
    'Mi 2','Mi 1S','12 Lite NE','Redmi 11','Redmi 10 Prime+ 5G','Poco X4 NFC',
    'Poco M3 Pro','Redmi 20X','Redmi 11A','Mi 10 Lite Zoom','Mi 9X','Mi Max 4 Pro',
    'Mi Max 4','Mi 6c','Redmi Pro 2','Mi Note Plus',
  ],

}
// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiBrand {
  brand_id:     number
  brand_name:   string
  brand_slug:   string
  device_count: number
}

export interface ApiPhone {
  brand:      string
  phone_name: string
  slug:       string
  image:      string | null
}

export interface SyncBrandsResult {
  inserted: number
  skipped:  number
  total:    number
  brands:   ApiBrand[]
}

export interface SyncModelesResult {
  brand_slug:     string
  brand_nom:      string
  modeles_added:  number
  modeles_total:  number
  pages_fetched:  number
  status:         'success' | 'error'
  error?:         string
}

export interface SyncAllResult {
  brands_synced:  number
  brands_failed:  number
  modeles_added:  number
  modeles_total:  number
  results:        SyncModelesResult[]
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    // Cloudflare Workers : cf cache pour réduire les appels répétés
    cf: { cacheTtl: 3600, cacheEverything: true } as any,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`)
  return resp.json()
}

// ─── syncBrands ───────────────────────────────────────────────────────────────

/**
 * Récupère toutes les marques depuis l'API et les insère dans `marques_appareils`.
 * INSERT OR IGNORE sur brand_slug → idempotent.
 * Met à jour device_count et synced_at si la marque existe déjà (source API).
 *
 * @returns SyncBrandsResult — nb insérées, ignorées, total, liste brute
 */
export async function syncBrands(db: D1Database): Promise<SyncBrandsResult> {
  let brands: ApiBrand[]
  let fromStatic = false

  try {
    // Tentative API externe avec timeout 8s
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const resp = await fetch(`${API_BASE}/brands`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    if (!data.status || !Array.isArray(data.data)) throw new Error('Réponse invalide')
    brands = data.data
  } catch (_err) {
    // Fallback dataset statique embarqué (API rate-limitée ou indisponible)
    brands = STATIC_BRANDS
    fromStatic = true
  }

  let inserted = 0
  let skipped  = 0

  for (const b of brands) {
    // INSERT si slug inconnu
    const res = await db.prepare(`
      INSERT OR IGNORE INTO marques_appareils (nom, brand_slug, device_count, source, synced_at)
      VALUES (?, ?, ?, 'api', CURRENT_TIMESTAMP)
    `).bind(b.brand_name.trim(), b.brand_slug, b.device_count).run()

    if (res.meta.changes === 0) {
      // Déjà existante — mise à jour device_count si source API
      await db.prepare(`
        UPDATE marques_appareils
        SET device_count = ?, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE brand_slug = ? AND source = 'api'
      `).bind(b.device_count, b.brand_slug).run()
      skipped++
    } else {
      inserted++
    }
  }

  return { inserted, skipped, total: brands.length, brands, fromStatic } as any
}

// ─── syncModelesByBrand ───────────────────────────────────────────────────────

/**
 * Synchronise tous les modèles d'une marque depuis l'API.
 * Pattern identique au create.php PHP legacy :
 *   1. Fetch page 1 → récupère last_page
 *   2. Promise.all pages 2..last_page en parallèle
 *   3. INSERT OR IGNORE sur phone_slug (idempotent)
 *
 * Cloudflare Workers : max 50 requêtes fetch() simultanées recommandé.
 * On chunk les pages par lots de 10 pour éviter les timeouts.
 *
 * @param db        D1 binding
 * @param brandSlug slug API ex: "apple-phones-48"
 * @param logId     optionnel — id du log existant à mettre à jour
 */
export async function syncModelesByBrand(
  db: D1Database,
  brandSlug: string,
  logId?: number
): Promise<SyncModelesResult> {
  // Récupérer l'id de la marque en base
  const marque = await db.prepare(`
    SELECT id, nom FROM marques_appareils WHERE brand_slug = ? AND actif = 1
  `).bind(brandSlug).first<{ id: number; nom: string }>()

  if (!marque) {
    return { brand_slug: brandSlug, brand_nom: '', modeles_added: 0, modeles_total: 0, pages_fetched: 0, status: 'error', error: `Marque introuvable en base pour slug: ${brandSlug}` }
  }

  // Log démarrage
  const logRow = logId
    ? { id: logId }
    : await db.prepare(`
        INSERT INTO phone_catalog_sync_log (brand_slug, brand_nom, status)
        VALUES (?, ?, 'pending')
        RETURNING id
      `).bind(brandSlug, marque.nom).first<{ id: number }>()

  try {
    let allPhones: ApiPhone[] = []
    let lastPage = 1

    // Tentative API externe avec timeout 10s
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const firstResp = await fetch(`${API_BASE}/brands/${brandSlug}?page=1`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!firstResp.ok) throw new Error(`HTTP ${firstResp.status}`)
      const firstPage = await firstResp.json() as any
      if (!firstPage.status || !firstPage.data) throw new Error('Réponse invalide')

      lastPage = firstPage.data.last_page ?? 1
      allPhones = [...(firstPage.data.phones ?? [])]

      // Pages suivantes par chunks de 5 (limite CPU Workers)
      if (lastPage > 1) {
        const pageNums = Array.from({ length: lastPage - 1 }, (_, i) => i + 2)
        const CHUNK_SIZE = 5
        for (let i = 0; i < pageNums.length; i += CHUNK_SIZE) {
          const chunk = pageNums.slice(i, i + CHUNK_SIZE)
          const results = await Promise.all(
            chunk.map(async p => {
              try {
                const r = await fetch(`${API_BASE}/brands/${brandSlug}?page=${p}`, {
                  headers: { 'Accept': 'application/json' }
                })
                if (!r.ok) return null
                return r.json()
              } catch { return null }
            })
          )
          for (const res of results) {
            if (res && (res as any).status && (res as any).data?.phones) {
              allPhones = allPhones.concat((res as any).data.phones)
            }
          }
        }
      }

    } catch (_apiErr) {
      // Fallback : dataset statique pour les marques connues
      const staticModeles = STATIC_MODELES[brandSlug]
      if (staticModeles && staticModeles.length > 0) {
        allPhones = staticModeles.map(nom => ({
          brand: marque.nom,
          phone_name: nom,
          slug: `${brandSlug}-${nom.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          image: null,
        }))
      }
      // Si pas de static non plus, on continue avec allPhones = [] (0 modèles)
    }

    // Déduplication sur phone_slug (l'API peut parfois dupliquer)
    const seen  = new Set<string>()
    const uniq  = allPhones.filter(p => {
      if (!p.slug || seen.has(p.slug)) return false
      seen.add(p.slug)
      return true
    })

    // Détection du type depuis le nom (heuristique simple)
    function guessType(name: string): string {
      const n = name.toLowerCase()
      if (n.includes('ipad') || n.includes('tab') || n.includes('tablet')) return 'tablette'
      if (n.includes('watch') || n.includes('gear') || n.includes('band')) return 'montre'
      if (n.includes('book') || n.includes('laptop') || n.includes('chromebook') || n.includes('macbook')) return 'pc'
      return 'smartphone'
    }

    // INSERT en batch D1 (une requête par modèle — D1 ne supporte pas les INSERT multi-lignes via bind)
    let modeles_added = 0
    for (const phone of uniq) {
      const res = await db.prepare(`
        INSERT OR IGNORE INTO modeles_appareils (marque_id, nom, phone_slug, type, image_url, source)
        VALUES (?, ?, ?, ?, ?, 'api')
      `).bind(
        marque.id,
        phone.phone_name.trim(),
        phone.slug,
        guessType(phone.phone_name),
        phone.image ?? null
      ).run()
      if (res.meta.changes > 0) modeles_added++
    }

    // Mettre à jour synced_at sur la marque
    await db.prepare(`
      UPDATE marques_appareils SET synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(marque.id).run()

    // Mettre à jour le log
    if (logRow?.id) {
      await db.prepare(`
        UPDATE phone_catalog_sync_log
        SET status = 'success', modeles_added = ?, modeles_total = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(modeles_added, uniq.length, logRow.id).run()
    }

    return {
      brand_slug:    brandSlug,
      brand_nom:     marque.nom,
      modeles_added,
      modeles_total: uniq.length,
      pages_fetched: lastPage,
      status:        'success',
    }

  } catch (err: any) {
    if (logRow?.id) {
      await db.prepare(`
        UPDATE phone_catalog_sync_log
        SET status = 'error', error_msg = ?, finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(err.message ?? 'Erreur inconnue', logRow.id).run()
    }
    return {
      brand_slug:    brandSlug,
      brand_nom:     marque.nom,
      modeles_added: 0,
      modeles_total: 0,
      pages_fetched: 0,
      status:        'error',
      error:         err.message ?? 'Erreur inconnue',
    }
  }
}

// ─── syncAllBrands ────────────────────────────────────────────────────────────

/**
 * Synchronise toutes les marques puis leurs modèles depuis l'API.
 * Appelé depuis la route POST /api/services/sync-all.
 *
 * ATTENTION : opération longue (~7000 modèles × N requêtes HTTP).
 * Cloudflare Workers CPU limit = 30ms (paid) — cette fonction dépasse la limite
 * si appelée directement. Elle est conçue pour être utilisée en mode
 * "sync par marque" individuelle (syncModelesByBrand) depuis l'UI.
 *
 * Pour un sync complet, l'UI déclenche syncBrands() puis itère marque par marque.
 *
 * @param db          D1 binding
 * @param brandSlugs  liste de slugs à synchroniser (subset, pas toutes les 126)
 */
export async function syncSelectedBrands(
  db: D1Database,
  brandSlugs: string[]
): Promise<SyncAllResult> {
  let brands_synced  = 0
  let brands_failed  = 0
  let modeles_added  = 0
  let modeles_total  = 0
  const results: SyncModelesResult[] = []

  for (const slug of brandSlugs) {
    const res = await syncModelesByBrand(db, slug)
    results.push(res)
    if (res.status === 'success') {
      brands_synced++
      modeles_added += res.modeles_added
      modeles_total += res.modeles_total
    } else {
      brands_failed++
    }
  }

  return { brands_synced, brands_failed, modeles_added, modeles_total, results }
}

// ─── getLastSyncStatus ────────────────────────────────────────────────────────

/**
 * Retourne le statut de la dernière synchronisation par marque.
 * Utilisé par l'UI pour afficher l'état du référentiel.
 */
export async function getLastSyncStatus(db: D1Database): Promise<object[]> {
  const rows = await db.prepare(`
    SELECT
      m.id, m.nom, m.brand_slug, m.device_count, m.source, m.synced_at,
      COUNT(mo.id) AS modeles_en_base,
      l.status     AS last_sync_status,
      l.started_at AS last_sync_at,
      l.error_msg  AS last_sync_error
    FROM marques_appareils m
    LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1
    LEFT JOIN (
      SELECT brand_slug, status, started_at, error_msg,
             ROW_NUMBER() OVER (PARTITION BY brand_slug ORDER BY started_at DESC) AS rn
      FROM phone_catalog_sync_log
    ) l ON l.brand_slug = m.brand_slug AND l.rn = 1
    WHERE m.actif = 1
    GROUP BY m.id
    ORDER BY m.nom ASC
  `).all()
  return rows.results
}

/**
 * Retourne les stats globales du catalogue.
 */
export async function getCatalogStats(db: D1Database): Promise<{
  total_marques: number
  total_modeles: number
  marques_api:   number
  modeles_api:   number
  last_sync:     string | null
}> {
  const [stats, lastSync] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(DISTINCT m.id)                                   AS total_marques,
        COUNT(mo.id)                                           AS total_modeles,
        COUNT(DISTINCT CASE WHEN m.source='api' THEN m.id END) AS marques_api,
        COUNT(CASE WHEN mo.source='api' THEN mo.id END)        AS modeles_api
      FROM marques_appareils m
      LEFT JOIN modeles_appareils mo ON mo.marque_id = m.id AND mo.actif = 1
      WHERE m.actif = 1
    `).first<any>(),
    db.prepare(`
      SELECT MAX(started_at) AS last_sync FROM phone_catalog_sync_log WHERE status = 'success'
    `).first<{ last_sync: string | null }>(),
  ])

  return {
    total_marques: stats?.total_marques ?? 0,
    total_modeles: stats?.total_modeles ?? 0,
    marques_api:   stats?.marques_api   ?? 0,
    modeles_api:   stats?.modeles_api   ?? 0,
    last_sync:     lastSync?.last_sync  ?? null,
  }
}
