-- DEMO DATA ONLY — synthetic fixtures; scans and AI output are simulated.
insert into public.policy_sources (code, title, level, url) values
  ('1.1.1','Non-text Content','A','https://www.w3.org/WAI/WCAG22/Understanding/non-text-content'),
  ('1.3.1','Info and Relationships','A','https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships'),
  ('1.4.3','Contrast (Minimum)','AA','https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum'),
  ('2.4.4','Link Purpose (In Context)','A','https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context'),
  ('2.4.7','Focus Visible','AA','https://www.w3.org/WAI/WCAG22/Understanding/focus-visible'),
  ('2.5.8','Target Size (Minimum)','AA','https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum'),
  ('3.1.1','Language of Page','A','https://www.w3.org/WAI/WCAG22/Understanding/language-of-page'),
  ('4.1.2','Name, Role, Value','A','https://www.w3.org/WAI/WCAG22/Understanding/name-role-value');

insert into public.projects (id, name, base_url) values
  ('00000000-0000-4000-8000-000000000001','Customer Portal (Demo)','https://portal.demo.meridian.test'),
  ('00000000-0000-4000-8000-000000000002','Careers Site (Demo)','https://careers.demo.meridian.test');

insert into public.scans (id, project_id, target_url, status, is_simulated, completed_at) values
  ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001','https://portal.demo.meridian.test/login','completed',true,now());

insert into public.findings (scan_id, rule_id, wcag, title, severity, status, selector, page_url) values
  ('00000000-0000-4000-8000-0000000000a1','image-alt','1.1.1','Image has no text alternative','critical','open','main img.hero','https://portal.demo.meridian.test/login'),
  ('00000000-0000-4000-8000-0000000000a1','label','1.3.1','Form field has no programmatic label','critical','in_review','form#signup input[type=email]','https://portal.demo.meridian.test/login'),
  ('00000000-0000-4000-8000-0000000000a1','color-contrast','1.4.3','Text contrast below 4.5:1','serious','ready_for_verification','.promo p.muted','https://portal.demo.meridian.test/login');
