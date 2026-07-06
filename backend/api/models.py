from django.db import models


class Reading(models.Model):
    """A single soil reading pushed by the ESP32 device.

    The RS485 3-in-1 sensor reports only N, P, K, so ph / moisture /
    temperature are optional (they come from other sensors or manual entry
    on the frontend). Every accepted reading is stored as its own row so the
    latest value and the history survive server restarts.
    """
    n = models.FloatField(null=True, blank=True)
    p = models.FloatField(null=True, blank=True)
    k = models.FloatField(null=True, blank=True)
    ph = models.FloatField(null=True, blank=True)
    moisture = models.FloatField(null=True, blank=True)
    temperature = models.FloatField(null=True, blank=True)
    # Which physical plot this reading came from (multi-field support). Null
    # means the reading wasn't tied to a registered field (e.g. a quick scan).
    field = models.ForeignKey('Field', null=True, blank=True, on_delete=models.SET_NULL, related_name='readings')
    device_id = models.CharField(max_length=64, blank=True)  # which ESP32 sent it
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"N={self.n} P={self.p} K={self.k} @ {self.created_at:%Y-%m-%d %H:%M:%S}"


class Farm(models.Model):
    """A farm that groups several fields (multi-field / multi-farm support).

    `owner_name` is a lightweight ownership tag. Full user accounts + RBAC are
    a deliberate follow-up; this model gives the multi-tenant data structure
    (farm -> fields -> readings) without wiring authentication yet.
    """
    name = models.CharField(max_length=100)
    owner_name = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=255, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Field(models.Model):
    """A physical plot of land tracked in the system.

    This is the DB-backed counterpart to the "Land" a farmer manages in the
    frontend. Registering a field's size is what makes automated fertilizer
    cost estimation possible (quantity scales with area), and tagging
    Readings with a field is the basis for multi-field / multi-farm support.

    `device_id` maps a physical ESP32 sensor to this field: when a reading is
    pushed with that id, it is auto-attached here. `latitude`/`longitude`
    place the field on the map dashboard.

    A land is also the unit of login (there are no separate farmer usernames):
    registering a land mints a public `land_id` and stores a hashed password.
    A farmer signs in with (land_id, password), receives `auth_token`, and every
    land-scoped API call carries that token so a land only ever sees its own
    data — this is what makes the system safe for many farmers, land to land.
    """
    farm = models.ForeignKey(Farm, null=True, blank=True, on_delete=models.SET_NULL, related_name='fields')
    name = models.CharField(max_length=100)
    details = models.CharField(max_length=255, blank=True)
    size_acres = models.FloatField(default=1.0)
    crop_key = models.CharField(max_length=50, blank=True)
    # Whether the farmer is tracking a crop already growing here ('existing') or
    # planning what to plant on an empty plot ('empty'). Persisted so the land's
    # chosen crop + mode follow the farmer to any device on login.
    mode = models.CharField(max_length=10, default='existing')  # 'existing' | 'empty'
    device_id = models.CharField(max_length=64, blank=True)  # ESP32 sensor id
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    # --- Owner + location (national roll-up) ------------------------------
    # Captured at registration so the admin can contact the farmer and so
    # fertilizer demand can be aggregated by district across the whole country.
    owner_name = models.CharField(max_length=100, blank=True)
    contact_number = models.CharField(max_length=20, blank=True)
    region = models.CharField(max_length=50, blank=True)  # Sri Lanka district

    # --- Login credentials (land = account) -------------------------------
    # Public code the farmer logs in with, e.g. "K7F9Q2". Unique, minted on
    # registration. Blank for legacy fields created before login existed.
    land_id = models.CharField(max_length=16, unique=True, null=True, blank=True, db_index=True)
    password_hash = models.CharField(max_length=255, blank=True)  # Django make_password
    auth_token = models.CharField(max_length=64, blank=True, db_index=True)  # current session token

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.size_acres} ac)"


class FertilizerType(models.Model):
    """Current market price for a fertilizer, used to cost a recommendation."""
    key = models.CharField(max_length=20, unique=True)  # 'urea' | 'tsp' | 'mop'
    name_en = models.CharField(max_length=50)
    name_si = models.CharField(max_length=50, blank=True)
    price_per_kg = models.FloatField()  # LKR
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name_en']

    def __str__(self):
        return f"{self.name_en} (LKR {self.price_per_kg}/kg)"


class CostEstimate(models.Model):
    """A logged fertilizer-cost calculation for a crop + field size.

    Persisted (rather than only computed client-side) so the admin panel can
    show a cost report and a month-by-month budget summary chart.
    """
    field = models.ForeignKey(Field, null=True, blank=True, on_delete=models.SET_NULL, related_name='cost_estimates')
    crop_key = models.CharField(max_length=50)
    size_acres = models.FloatField()
    urea_kg = models.FloatField(default=0)
    tsp_kg = models.FloatField(default=0)
    mop_kg = models.FloatField(default=0)
    urea_cost = models.FloatField(default=0)
    tsp_cost = models.FloatField(default=0)
    mop_cost = models.FloatField(default=0)
    total_cost = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.crop_key} {self.size_acres}ac -> LKR {self.total_cost:.0f}"


class CropGuideline(models.Model):
    """Recommended soil ranges and watering plan for one crop.

    The frontend compares a live reading against these min/max bands to show
    each nutrient as low / optimal / high, and displays the watering schedule.
    """
    crop_key = models.CharField(max_length=50, unique=True)  # e.g. 'rice'
    name_en = models.CharField(max_length=100)
    name_si = models.CharField(max_length=100, blank=True)

    n_min = models.FloatField()
    n_max = models.FloatField()
    p_min = models.FloatField()
    p_max = models.FloatField()
    k_min = models.FloatField()
    k_max = models.FloatField()
    ph_min = models.FloatField()
    ph_max = models.FloatField()
    moisture_min = models.FloatField()
    moisture_max = models.FloatField()

    water_frequency_days = models.IntegerField(default=3)
    water_amount_mm = models.FloatField(default=25)  # mm of water per irrigation
    notes_en = models.TextField(blank=True)
    notes_si = models.TextField(blank=True)

    class Meta:
        ordering = ['name_en']

    def __str__(self):
        return f"{self.name_en} ({self.crop_key})"


class TrainingSample(models.Model):
    """A labelled soil sample used to train the crop-recommendation model.

    Unlike a live Reading, every field is required and the row carries the
    `crop` label (which crop suits this soil). The admin page manages these
    rows and the KNN model in ml.py is trained on them.
    """
    n = models.FloatField()
    p = models.FloatField()
    k = models.FloatField()
    ph = models.FloatField()
    moisture = models.FloatField()
    crop = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.crop}: N={self.n} P={self.p} K={self.k} pH={self.ph} m={self.moisture}"


class StaffAccount(models.Model):
    """A non-farmer login for the national platform (role-based access).

    Farmers sign in per-land (see Field.land_id); staff are people who oversee
    the data across many lands. Roles gate what they can do:
      - government: read-only national dashboards (regional soil health + demand)
      - agronomist: the above + manage crop-model training data
      - admin: everything, including creating other staff and editing prices
    The legacy X-Admin-Password still works as a bootstrap super-admin, so the
    very first admin account can be created without already having one.
    """
    ROLES = [('government', 'Government'), ('agronomist', 'Agronomist'), ('admin', 'Admin')]

    username = models.CharField(max_length=50, unique=True, db_index=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=ROLES, default='government')
    full_name = models.CharField(max_length=100, blank=True)
    auth_token = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['username']

    def __str__(self):
        return f"{self.username} ({self.role})"
