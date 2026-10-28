// Seeded demo prospect.
//
// A FICTIONAL business. There is no Harbor & Vine Plumbing; the name, phone
// number and address are invented, and the domain is reserved for examples. The
// page below is a realistic 2000s-era small business site, built to fail the
// same checks real sites fail, so the demo exercises the real loop rather than
// replaying a recording:
//
//   - no viewport meta, 980px fixed-width table layout  -> overflow on mobile
//   - phone number as plain text                         -> no click to call
//   - #9a9a9a on white body copy                         -> contrast failure
//   - 11px nav links with no padding                     -> tap targets
//   - images with no alt attribute                       -> alt text
//   - h1 followed by h3, two h1s                         -> heading structure
//   - no meta description, 8-character title             -> title/description
//   - no lang attribute                                  -> language
//
// Every check that runs against it is the real check suite at the real
// viewports. Only the discovery and page fetch are seeded.

const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACwAAAAAAQABAAACAkQBADs=';

export const DEMO_PROSPECT = {
  id: 'demo-harbor-vine-plumbing',
  business_name: 'Harbor & Vine Plumbing',
  url: 'https://harbor-vine-plumbing.example',
  niche: 'plumbers',
  city: 'San Diego, CA',
  fictional: true,
  disclaimer:
    'Fictional sample business used for the seeded demo. The name, phone number and address are invented and the domain is reserved for documentation use.',
  page_text: `Harbor & Vine Plumbing
Serving San Diego since 1987

Home | Services | About Us | Contact | Testimonials

WELCOME TO OUR WEBSITE

Harbor & Vine Plumbing has been serving the greater San Diego area for over
thirty-five years. We are a family owned and operated business. Second
generation owner Ray Vine took over from his father in 2004 and still runs
every call himself.

Our Services:
- Drain cleaning and hydro jetting
- Water heater repair and replacement
- Repiping (copper and PEX)
- Slab leak detection
- Sewer camera inspection
- Emergency burst pipe repair

We are fully licensed, bonded and insured. California contractor license
number on request.

Call us at (619) 555-0142 during business hours.
Monday through Friday, 7am to 4pm. Emergency service available.

Office: 2847 Example Harbor Way, San Diego, CA 92101

What our customers say:
"Ray showed up on a Sunday for our burst pipe. Fair price, no drama." - M. Okafor
"They repiped our whole house in three days." - D. Whitfield

Copyright 1998-2024 Harbor & Vine Plumbing. All rights reserved.
Site last updated March 2011.`,
};

export const demoPageHtml = () => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head>
<title>Plumbing</title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style type="text/css">
  body { margin:0; padding:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:13px; color:#9a9a9a; }
  #wrap { width:980px; margin:0 auto; }
  #header { height:92px; background:#1f3a5f; color:#8fa8c4; padding:14px 18px; }
  #header h1 { font-size:26px; margin:0; color:#b9c9da; font-family:Georgia, serif; }
  #header .tag { font-size:12px; color:#7e97b2; }
  #nav { background:#e8e8e8; border-bottom:1px solid #cccccc; padding:3px 18px; }
  #nav a { font-size:11px; color:#8b8b8b; text-decoration:none; margin-right:14px; line-height:14px; display:inline-block; }
  #nav a:hover { text-decoration:underline; }
  .col-main { width:660px; padding:18px; vertical-align:top; }
  .col-side { width:280px; padding:18px; background:#f4f4f4; vertical-align:top; font-size:12px; }
  h1.section { font-size:18px; color:#aaaaaa; font-family:Georgia, serif; font-weight:normal; }
  h3 { font-size:14px; color:#999999; margin-bottom:4px; }
  ul.services { padding-left:18px; }
  ul.services li { margin-bottom:3px; }
  .phone { font-size:15px; color:#9a9a9a; font-weight:bold; }
  .hours { font-size:11px; color:#a8a8a8; }
  #footer { background:#e8e8e8; border-top:1px solid #cccccc; padding:10px 18px; font-size:10px; color:#a0a0a0; }
  .banner-img { width:944px; height:110px; background:#2a4a74; display:block; }
  table { border-collapse:collapse; }
</style>
</head>
<body>
<div id="wrap">

  <div id="header">
    <h1>Harbor &amp; Vine Plumbing</h1>
    <div class="tag">Serving San Diego since 1987</div>
  </div>

  <div id="nav">
    <a href="#home">Home</a><a href="#services">Services</a><a href="#about">About Us</a><a href="#contact">Contact</a><a href="#testimonials">Testimonials</a>
  </div>

  <img src="${PIXEL}" class="banner-img">

  <table width="980">
    <tr>
      <td class="col-main">
        <h1 class="section">Welcome To Our Website</h1>

        <p>Harbor &amp; Vine Plumbing has been serving the greater San Diego area for over thirty-five years. We are a family owned and operated business. Second generation owner Ray Vine took over from his father in 2004 and still runs every call himself.</p>

        <h3 id="services">Our Services</h3>
        <ul class="services">
          <li>Drain cleaning and hydro jetting</li>
          <li>Water heater repair and replacement</li>
          <li>Repiping (copper and PEX)</li>
          <li>Slab leak detection</li>
          <li>Sewer camera inspection</li>
          <li>Emergency burst pipe repair</li>
        </ul>

        <p>We are fully licensed, bonded and insured. California contractor license number on request.</p>

        <h3 id="testimonials">What Our Customers Say</h3>
        <p><em>&ldquo;Ray showed up on a Sunday for our burst pipe. Fair price, no drama.&rdquo;</em> &mdash; M. Okafor</p>
        <p><em>&ldquo;They repiped our whole house in three days.&rdquo;</em> &mdash; D. Whitfield</p>

        <img src="${PIXEL}" width="620" height="90">
      </td>

      <td class="col-side">
        <h3 id="contact">Contact Us</h3>
        <p class="phone">Call us at (619) 555-0142</p>
        <p class="hours">during business hours.<br>Monday through Friday, 7am to 4pm.<br>Emergency service available.</p>
        <p>Office:<br>2847 Example Harbor Way<br>San Diego, CA 92101</p>
        <p><a href="#contact" style="font-size:11px;color:#8b8b8b;">Send us a message</a></p>
      </td>
    </tr>
  </table>

  <div id="footer">
    Copyright 1998-2024 Harbor &amp; Vine Plumbing. All rights reserved. Site last updated March 2011.
  </div>

</div>
</body>
</html>`;

DEMO_PROSPECT.html = demoPageHtml();
