INSERT INTO taxonomy(id,kind,name) VALUES
('level-4','level','Level 4'),('level-5','level','Level 5'),('level-6','level','Level 6'),
('body-cdacc','body','CDACC'),('body-knec','body','KNEC'),('body-institution','body','Institution'),
('type-past','type','Past Paper'),('type-revision','type','Revision Paper'),('type-marking','type','Marking Scheme'),('type-notes','type','Study Notes'),('type-model','type','Model Paper')
ON CONFLICT(kind,name) DO NOTHING;
