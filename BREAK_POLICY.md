# Unpaid hours calculation policy

**Breaks, Offline Hours & Lunch are considered unpaid.** Deduct all recorded break minutes from the total elapsed time between clock-in and clock-out when calculating hours rendered. Lunch and offline/outage periods are also unpaid deductions.

The intended calculation is:

`hours rendered = max(0, clock-out − clock-in − all unpaid break/lunch/offline minutes)`

Example: a 9-hour shift with 30 minutes of break, 1 hour of lunch, and 15 minutes offline renders 7 hours 15 minutes.

**Implementation note:** the current `app.html` calculation still treats Break 1, Break 2, and Bio break as paid and deducts only Lunch and Offline. The application calculation must be updated to match this policy before the behavior described above is live.
