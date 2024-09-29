import { boolean, object, parse, picklist, string } from "valibot";

import { CommandError } from "../../error";
import { PermissionLevel } from "../../perms";
import { Plugin } from "../../plugins";

const apiKey = process.env.VERIPHONE_API_KEY;

if (!apiKey) {
  throw new Error("$VERIPHONE_API_KEY environment variable must be set");
}

const schema = object({
  status: picklist(["success", "error"]),
  phone: string(),
  phone_valid: boolean(),
  phone_type: picklist([
    "fixed_line",
    "mobile",
    "unknown",
    "fixed_line_or_mobile",
    "toll_free",
    "premium_rate",
    "shared_cost",
    "voip",
  ]),
  phone_region: string(),
  country: string(),
  country_code: string(),
  country_prefix: string(),
  international_number: string(),
  local_number: string(),
  e164: string(),
  carrier: string(),
});

export default class extends Plugin {
  id = "veriphone";
  name = "Veriphone";
  description = "Verifies and looks up phone numbers using the Veriphone API";
  version = "0.0.1";

  constructor() {
    super();

    this.registerCommands([
      {
        name: "veriphone",
        description: "Looks up a phone number",
        minLevel: PermissionLevel.NONE,
        rateLimit: [
          {
            duration: 10000,
            max: 1,
          },
        ],

        async handler({ message, data }) {
          let phoneNumber = "";

          if (data) {
            phoneNumber = data;
          } else {
            const contact = await message.getContact();
            phoneNumber = contact.number;
          }

          const veriphone = parse(
            schema,
            await fetch(
              `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(phoneNumber)}&key=${encodeURIComponent(apiKey!)}`,
            ).then((r) => r.json()),
          );

          if (veriphone.status === "error") {
            throw new CommandError("failed to look up phone number");
          }

          if (!veriphone.phone_valid) {
            throw new CommandError("phone number is not valid");
          }

          return `\
*Phone number: ${veriphone.phone}*
* International number: ${veriphone.international_number}
* Local number: ${veriphone.local_number}
* E164 number: ${veriphone.e164}
* Country: ${veriphone.country} (${veriphone.country_code})
* Region: ${veriphone.phone_region} (${veriphone.country_prefix})
* Type: ${veriphone.phone_type}
* Carrier: ${veriphone.carrier}`;
        },
      },
    ]);
  }
}
