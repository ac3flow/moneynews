// Public-domain / CC0 photographs from Wikimedia Commons, used when none of a story's sources supplied a picture.
// Each one was picked by hand for its topic and checked against Commons' machine-readable licence field
// (Public domain, CC0 or "No restrictions"), so none needs attribution, but the credit is shown anyway.
// They are hotlinked from thumb.wikimedia.org at 960-1280 px; nothing is copied into this repository.

export type StockTopic = 'tech' | 'economy' | 'crypto' | 'property' | 'trade' | 'world' | 'startups' | 'general' | 'georgia';

export interface StockPhoto {
  url: string;
  title: string;
  author: string;
  license: string;
  /** The photograph's page on Wikimedia Commons. */
  page: string;
}

export const STOCK_PHOTOS: Record<StockTopic, StockPhoto[]> = {
  tech: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Data_center_roof.jpg/1280px-Data_center_roof.jpg", title: "Data center roof", author: "Rsparks3", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Data_center_roof.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Circuit_board_after_manual_etching.jpg/1280px-Circuit_board_after_manual_etching.jpg", title: "Circuit board after manual etching", author: "Tinux", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Circuit_board_after_manual_etching.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/42/Circuit_board_with_protective_layer_ready_for_etching.jpg/1280px-Circuit_board_with_protective_layer_ready_for_etching.jpg", title: "Circuit board with protective layer ready for etching", author: "Tinux", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Circuit_board_with_protective_layer_ready_for_etching.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0e/Etched_circuit_board_after_cleaning.jpg/1280px-Etched_circuit_board_after_cleaning.jpg", title: "Etched circuit board after cleaning", author: "Tinux", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Etched_circuit_board_after_cleaning.jpg" },
  ],
  economy: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Eccles_Building_%2826088200676%29.jpg/1280px-Eccles_Building_%2826088200676%29.jpg", title: "Eccles Building (26088200676)", author: "Federalreserve", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Eccles_Building_(26088200676).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/04/US_Federal_Reserve_Eccles_Building_1937.jpg/1280px-US_Federal_Reserve_Eccles_Building_1937.jpg", title: "US Federal Reserve Eccles Building 1937", author: "Federalreserve", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:US_Federal_Reserve_Eccles_Building_1937.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Trading_floor%2C_New_York_Stock_Exchange%2C_New_York%2C_New_York_LCCN2011630168.tif/lossy-page1-1280px-Trading_floor%2C_New_York_Stock_Exchange%2C_New_York%2C_New_York_LCCN2011630168.tif.jpg", title: "Trading floor, New York Stock Exchange, New York, New York LCCN2011630168", author: "Carol M. Highsmith", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Trading_floor,_New_York_Stock_Exchange,_New_York,_New_York_LCCN2011630168.tif" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/80/New_York_Stock_Exchange_trading_floor_on_Wall_Street%2C_New_York%2C_New_York_LCCN2011634218.tif/lossy-page1-1280px-New_York_Stock_Exchange_trading_floor_on_Wall_Street%2C_New_York%2C_New_York_LCCN2011634218.tif.jpg", title: "New York Stock Exchange trading floor on Wall Street, New York, New York LCCN2011634218", author: "Carol M. Highsmith", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:New_York_Stock_Exchange_trading_floor_on_Wall_Street,_New_York,_New_York_LCCN2011634218.tif" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/National_Bank_of_Romania%2C_old_building%2C_Strada_Lipscani_facade%2C_Bucharest%2C_2017.jpg/1280px-National_Bank_of_Romania%2C_old_building%2C_Strada_Lipscani_facade%2C_Bucharest%2C_2017.jpg", title: "National Bank of Romania, old building, Strada Lipscani facade, Bucharest, 2017", author: "DimiTalen", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:National_Bank_of_Romania,_old_building,_Strada_Lipscani_facade,_Bucharest,_2017.jpg" },
  ],
  crypto: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/Cryptocurrency_logos.jpg/1280px-Cryptocurrency_logos.jpg", title: "Cryptocurrency logos", author: "voytek pavlik", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Cryptocurrency_logos.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c2/Italian_States-Piacenza_1626_2_Doppie.jpg/1280px-Italian_States-Piacenza_1626_2_Doppie.jpg", title: "Italian States-Piacenza 1626 2 Doppie", author: "Italian States, Piacenza", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Italian_States-Piacenza_1626_2_Doppie.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/Two_20kr_gold_coins.png/1280px-Two_20kr_gold_coins.png", title: "Two 20kr gold coins", author: "Anonimski", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Two_20kr_gold_coins.png" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/44/Branch_Mint_Sovereigns.jpg/1280px-Branch_Mint_Sovereigns.jpg", title: "Branch Mint Sovereigns", author: "Snd3054", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Branch_Mint_Sovereigns.jpg" },
  ],
  property: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/67/New_residential_buildings_with_balconies_above_the_shops_of_the_shopping_center_Oostpoort_in_the_district_Amsterdam-Oost%3B_free_architecture_photo_by_Fons_Heijnsbroek%2C_January_2014.tif/lossy-page1-1280px-thumbnail.tif.jpg", title: "New residential buildings with balconies above the shops of the shopping center Oostpoort in the district Amsterdam-Oost; free architecture photo by Fons Heijnsbroek, January 2014", author: "Fons Heijnsbroek", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:New_residential_buildings_with_balconies_above_the_shops_of_the_shopping_center_Oostpoort_in_the_district_Amsterdam-Oost;_free_architecture_photo_by_Fons_Heijnsbroek,_January_2014.tif" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3b/Amsterdam_photo_of_construction_cranes_2016%2C_free_download%3B_view_on_the_construction_sites_of_the_future_Pontsteiger_and_residential_area_Houthavens._Fons_Heijnsbroek%2C_street_photography_of_The_Netherlands_in_high_resolution%3B_free_image.tif/lossy-page1-1280px-thumbnail.tif.jpg", title: "Amsterdam photo of construction cranes 2016, free download; view on the construction sites of the future Pontsteiger and residential area Houthavens. Fons Heijnsbroek, street photography of The Netherlands in high resolution; free image", author: "Fons Heijnsbroek", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Amsterdam_photo_of_construction_cranes_2016,_free_download;_view_on_the_construction_sites_of_the_future_Pontsteiger_and_residential_area_Houthavens._Fons_Heijnsbroek,_street_photography_of_The_Netherlands_in_high_resolution;_free_image.tif" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/ba/2005%2C_Amsterdam_photo_of_a_view_over_the_construction_site_Oosterdokseiland%2C_seen_from_the_CS_Post_building._To_the_left_the_curving_river_IJ._City_photography_of_The_Netherlands_by_Fons_Heijnsbroek_-_free_download_photo.jpg/1280px-thumbnail.jpg", title: "2005, Amsterdam photo of a view over the construction site Oosterdokseiland, seen from the CS Post building. To the left the curving river IJ. City photography of The Netherlands by Fons Heijnsbroek - free download photo", author: "Fons Heijnsbroek", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:2005,_Amsterdam_photo_of_a_view_over_the_construction_site_Oosterdokseiland,_seen_from_the_CS_Post_building._To_the_left_the_curving_river_IJ._City_photography_of_The_Netherlands_by_Fons_Heijnsbroek_-_free_download_photo.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/24/Skyscrapers_in_Mexico_City.jpg/1280px-Skyscrapers_in_Mexico_City.jpg", title: "Skyscrapers in Mexico City", author: "Dudva", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Skyscrapers_in_Mexico_City.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Skyscrapers_at_Tianfu_Square_in_Chengdu_city_center.jpg/1280px-Skyscrapers_at_Tianfu_Square_in_Chengdu_city_center.jpg", title: "Skyscrapers at Tianfu Square in Chengdu city center", author: "Dudva", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Skyscrapers_at_Tianfu_Square_in_Chengdu_city_center.jpg" },
  ],
  trade: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/45/Aerial_view_of_shipping_containers%2C_and_big_container_cranes_at_Tacoma%27s_container_port_-a.jpg/1280px-Aerial_view_of_shipping_containers%2C_and_big_container_cranes_at_Tacoma%27s_container_port_-a.jpg", title: "Aerial view of shipping containers, and big container cranes at Tacoma's container port -a", author: "Brian Harris", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Aerial_view_of_shipping_containers,_and_big_container_cranes_at_Tacoma%27s_container_port_-a.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/15/Cranes_in_the_Port_of_Algeciras_and_Gibraltar.jpg/1280px-Cranes_in_the_Port_of_Algeciras_and_Gibraltar.jpg", title: "Cranes in the Port of Algeciras and Gibraltar", author: "Wikipek", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Cranes_in_the_Port_of_Algeciras_and_Gibraltar.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Aerial_photograph_of_the_Port_of_Miami_Container_Port.jpg/1280px-Aerial_photograph_of_the_Port_of_Miami_Container_Port.jpg", title: "Aerial photograph of the Port of Miami Container Port", author: "James R. Tourtellotte", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Aerial_photograph_of_the_Port_of_Miami_Container_Port.jpg" },
  ],
  world: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/96/Flag-of-the-United-Nations.jpg/1280px-Flag-of-the-United-Nations.jpg", title: "Flag-of-the-United-Nations", author: "Makaristos", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Flag-of-the-United-Nations.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3e/The_Flag_of_the_United_Nations_%285013025102%29.jpg/1280px-The_Flag_of_the_United_Nations_%285013025102%29.jpg", title: "The Flag of the United Nations (5013025102)", author: "USAID U.S. Agency for International Development", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:The_Flag_of_the_United_Nations_(5013025102).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/United_Nations_Memorial_Cemetery_03.jpg/1280px-United_Nations_Memorial_Cemetery_03.jpg", title: "United Nations Memorial Cemetery 03", author: "Bernard Gagnon", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:United_Nations_Memorial_Cemetery_03.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/ff/1794_Samuel_Dunn_Wall_Map_of_the_World_in_Hemispheres_-_Geographicus_-_World2-dunn-1794.jpg/1280px-1794_Samuel_Dunn_Wall_Map_of_the_World_in_Hemispheres_-_Geographicus_-_World2-dunn-1794.jpg", title: "1794 Samuel Dunn Wall Map of the World in Hemispheres - Geographicus - World2-dunn-1794", author: "Thomas Kitchin", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:1794_Samuel_Dunn_Wall_Map_of_the_World_in_Hemispheres_-_Geographicus_-_World2-dunn-1794.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cb/Darton_%26_Co._-_Darton%E2%80%99s_pocket_globe_-_Whipple_Wh.0076.jpg/1280px-Darton_%26_Co._-_Darton%E2%80%99s_pocket_globe_-_Whipple_Wh.0076.jpg", title: "Darton & Co. - Darton’s pocket globe - Whipple Wh.0076", author: "Marsupium", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Darton_%26_Co._-_Darton%E2%80%99s_pocket_globe_-_Whipple_Wh.0076.jpg" },
  ],
  startups: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/SES-10_Launch_-_world%27s_first_reflight_of_an_orbital_class_rocket_%2833361035200%29.jpg/1280px-SES-10_Launch_-_world%27s_first_reflight_of_an_orbital_class_rocket_%2833361035200%29.jpg", title: "SES-10 Launch - world's first reflight of an orbital class rocket (33361035200)", author: "SpaceX", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:SES-10_Launch_-_world%27s_first_reflight_of_an_orbital_class_rocket_(33361035200).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/Laptop_on_a_desk_%28Unsplash%29.jpg/1280px-Laptop_on_a_desk_%28Unsplash%29.jpg", title: "Laptop on a desk (Unsplash)", author: "Aleksi Tappura a", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Laptop_on_a_desk_(Unsplash).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0b/Laptop_and_a_mug_%28Unsplash%29.jpg/1280px-Laptop_and_a_mug_%28Unsplash%29.jpg", title: "Laptop and a mug (Unsplash)", author: "Ryan Riggins ryan_riggins", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Laptop_and_a_mug_(Unsplash).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8b/Laptop_on_a_neat_desk_%28Unsplash%29.jpg/1280px-Laptop_on_a_neat_desk_%28Unsplash%29.jpg", title: "Laptop on a neat desk (Unsplash)", author: "Norbert Levajsics levajsics", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Laptop_on_a_neat_desk_(Unsplash).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c0/Laptop_on_desk_book_stacks_%28Unsplash%29.jpg/1280px-Laptop_on_desk_book_stacks_%28Unsplash%29.jpg", title: "Laptop on desk book stacks (Unsplash)", author: "freddie marriage fredmarriage", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Laptop_on_desk_book_stacks_(Unsplash).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Laptop_and_lamp_on_table_%28Unsplash%29.jpg/1280px-Laptop_and_lamp_on_table_%28Unsplash%29.jpg", title: "Laptop and lamp on table (Unsplash)", author: "Tatiana Lapina veila", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Laptop_and_lamp_on_table_(Unsplash).jpg" },
  ],
  general: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8b/Price_Building_illuminated_at_night_in_Quebec_City.jpg/1280px-Price_Building_illuminated_at_night_in_Quebec_City.jpg", title: "Price Building illuminated at night in Quebec City", author: "Wilfredor", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Price_Building_illuminated_at_night_in_Quebec_City.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d9/Chateau_Frontenac_illuminated_at_night_in_Quebec_City.jpg/1280px-Chateau_Frontenac_illuminated_at_night_in_Quebec_City.jpg", title: "Chateau Frontenac illuminated at night in Quebec City", author: "Wilfredor", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Chateau_Frontenac_illuminated_at_night_in_Quebec_City.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/%28Venice%29_French_goldsmith%2C_mechanical_celestial_and_terrestrial_globe%2C_post_1565_-_Correr_Museum.jpg/1280px-%28Venice%29_French_goldsmith%2C_mechanical_celestial_and_terrestrial_globe%2C_post_1565_-_Correr_Museum.jpg", title: "(Venice) French goldsmith, mechanical celestial and terrestrial globe, post 1565 - Correr Museum", author: "Didier Descouens", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:(Venice)_French_goldsmith,_mechanical_celestial_and_terrestrial_globe,_post_1565_-_Correr_Museum.jpg" },
  ],
  georgia: [
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Tbilisi_Peace_Bridge_and_Rike_Park.jpg/1280px-Tbilisi_Peace_Bridge_and_Rike_Park.jpg", title: "Tbilisi Peace Bridge and Rike Park", author: "falco", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Tbilisi_Peace_Bridge_and_Rike_Park.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b4/Tbilisi_Peace_Bridge_and_Kura_River_by_Falco.jpg/1280px-Tbilisi_Peace_Bridge_and_Kura_River_by_Falco.jpg", title: "Tbilisi Peace Bridge and Kura River by Falco", author: "falco", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Tbilisi_Peace_Bridge_and_Kura_River_by_Falco.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0b/Rike_Park_viewed_from_Tbilisi%27s_Peace_Bridge.jpg/1280px-Rike_Park_viewed_from_Tbilisi%27s_Peace_Bridge.jpg", title: "Rike Park viewed from Tbilisi's Peace Bridge", author: "falco", license: "CC0", page: "https://commons.wikimedia.org/wiki/File:Rike_Park_viewed_from_Tbilisi%27s_Peace_Bridge.jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b7/Rustaveli_Avenue%2C_Tbilisi_%28A%29.jpg/1280px-Rustaveli_Avenue%2C_Tbilisi_%28A%29.jpg", title: "Rustaveli Avenue, Tbilisi (A)", author: "Kober", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Rustaveli_Avenue,_Tbilisi_(A).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Rustaveli_Avenue%2C_Tbilisi_%28B%29.jpg/1280px-Rustaveli_Avenue%2C_Tbilisi_%28B%29.jpg", title: "Rustaveli Avenue, Tbilisi (B)", author: "Kober", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Rustaveli_Avenue,_Tbilisi_(B).jpg" },
    { url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8f/Gergeti_Trinity_Church_NW_side.jpg/1280px-Gergeti_Trinity_Church_NW_side.jpg", title: "Gergeti Trinity Church NW side", author: "Alexander Roumega", license: "Public domain", page: "https://commons.wikimedia.org/wiki/File:Gergeti_Trinity_Church_NW_side.jpg" },
  ],
};

const TOPIC_OF: Record<string, StockTopic> = {
  'AI & Tech': 'tech',
  Economics: 'economy',
  Crypto: 'crypto',
  'Real Estate': 'property',
  'Global Trade': 'trade',
  Geopolitics: 'world',
  'VC & Startups': 'startups',
  General: 'general',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The stock photograph for a story: from the Georgia set for Georgian stories, otherwise from its topic's
 * set, and always the same one for the same story id so a story keeps its picture between visits.
 */
export function stockPhotoFor(id: string, category: string, georgia: boolean): StockPhoto {
  const set = STOCK_PHOTOS[georgia ? 'georgia' : (TOPIC_OF[category] ?? 'general')];
  return set[hash(id) % set.length] as StockPhoto;
}
