select title, company, location, source, ats,
       left(description, 150) as preview, apply_url
from jobs
where status = 'to_score'
order by company;