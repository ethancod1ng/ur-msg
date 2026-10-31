# Kayabacho commute filtering design

The monitor will treat a room as eligible only when its conservative estimated commute to Kayabacho is at most 60 minutes. The estimate uses UR's own station-to-station travel-time XML, then adds the largest walking and bus durations shown in the property's access range. If no property access station can be matched reliably to UR's travel-time data, the room is excluded rather than risking a distant notification.

Telegram messages will prioritize the user's decision criteria: rent plus common fee, conservative commute time and transfers, nearest usable station, room layout, and a short reason the listing matched. Long raw access strings will no longer be included.

